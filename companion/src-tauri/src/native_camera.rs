//! Native camera measurement prototype.
//!
//! This module deliberately stops at the native model boundary. The WebView
//! remains the scoring source until a recorded-frame parity run passes. The
//! models below are byte-for-byte slices of the legacy FaceMesh package that
//! the current JavaScript path uses; they are not replacement Tasks models.

use std::{
    ffi::{c_char, c_void, CStr},
    path::Path,
    ptr::NonNull,
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use libloading::Library;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use self::{capture::NativeCapture, pipeline::NativeFacePipeline};

mod capture;
mod pipeline;
mod reference;

pub use reference::{
    run_reference_harness, run_reference_harness_with_roi_oracle, ReferenceHarnessSummary,
};

const NATIVE_CAMERA_STALE_AFTER: Duration = Duration::from_secs(1);
const NATIVE_CAMERA_EVENT: &str = "native-camera-landmarks";
const NATIVE_CAMERA_STATUS_EVENT: &str = "native-camera-status";

#[derive(Clone, Default)]
pub struct NativeCameraState {
    inner: Arc<Mutex<NativeCameraRuntime>>,
}

#[derive(Default)]
struct NativeCameraRuntime {
    status: NativeCameraStatus,
    stop: Option<mpsc::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCameraStatus {
    state: String,
    fault: Option<String>,
    frame_sequence: u64,
    last_frame_at_ms: Option<u64>,
}

impl Default for NativeCameraStatus {
    fn default() -> Self {
        Self {
            state: "stopped".into(),
            fault: None,
            frame_sequence: 0,
            last_frame_at_ms: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeLandmarkEvent {
    frame_sequence: u64,
    captured_at_ms: u64,
    frame_present: bool,
    face_present: bool,
    landmarks: Option<Vec<pipeline::Landmark>>,
}

#[tauri::command]
pub fn get_native_camera_status(state: State<'_, NativeCameraState>) -> NativeCameraStatus {
    state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status
        .clone()
}

#[tauri::command]
pub fn start_native_camera_prototype(
    app: AppHandle,
    state: State<'_, NativeCameraState>,
) -> Result<NativeCameraStatus, String> {
    let previous_worker = {
        let mut runtime = state
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(worker) = runtime.worker.as_ref() {
            // `faulted/no_frames` is recoverable and its worker intentionally
            // remains alive waiting for AVFoundation. Joining it here without
            // first stopping it would deadlock a repeated start command.
            if !worker.is_finished() {
                return Ok(runtime.status.clone());
            }
        }
        runtime.stop = None;
        runtime.worker.take()
    };
    if let Some(worker) = previous_worker {
        let _ = worker.join();
    }

    let (stop_sender, stop_receiver) = mpsc::channel();
    let shared = state.inner.clone();
    {
        let mut runtime = shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        runtime.status = NativeCameraStatus {
            state: "starting".into(),
            fault: None,
            frame_sequence: 0,
            last_frame_at_ms: None,
        };
        runtime.stop = Some(stop_sender);
    }
    let worker_shared = shared.clone();
    let worker = match thread::Builder::new()
        .name("eudonomia-native-camera".into())
        .spawn(move || run_native_camera(app, worker_shared, stop_receiver))
    {
        Ok(worker) => worker,
        Err(error) => {
            let mut runtime = shared
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime.status.state = "faulted".into();
            runtime.status.fault = Some("worker".into());
            runtime.stop = None;
            return Err(error.to_string());
        }
    };

    let mut runtime = shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtime.worker = Some(worker);
    Ok(runtime.status.clone())
}

#[tauri::command]
pub fn stop_native_camera_prototype(state: State<'_, NativeCameraState>) -> NativeCameraStatus {
    let (stop, worker) = {
        let mut runtime = state
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (runtime.stop.take(), runtime.worker.take())
    };
    if let Some(stop) = stop {
        let _ = stop.send(());
    }
    if let Some(worker) = worker {
        let _ = worker.join();
    }
    state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .status
        .clone()
}

fn run_native_camera(
    app: AppHandle,
    shared: Arc<Mutex<NativeCameraRuntime>>,
    stop: mpsc::Receiver<()>,
) {
    let mut pipeline = match NativeFacePipeline::new() {
        Ok(pipeline) => pipeline,
        Err(error) => {
            set_camera_fault(&app, &shared, "inference", error);
            return;
        }
    };
    let (capture, frames) = match NativeCapture::start() {
        Ok(capture) => capture,
        Err(error) => {
            set_camera_fault(&app, &shared, "capture", error);
            return;
        }
    };
    set_camera_status(&app, &shared, "running", None);

    let mut last_frame = Instant::now();
    let mut stale_reported = false;
    let mut ended_with_fault = false;
    loop {
        if stop.try_recv().is_ok() {
            break;
        }
        match frames.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => {
                last_frame = Instant::now();
                stale_reported = false;
                let (sequence, captured_at_ms) = record_real_frame(&shared);
                match pipeline.process(&frame) {
                    Ok(landmarks) => {
                        let event = NativeLandmarkEvent {
                            frame_sequence: sequence,
                            captured_at_ms,
                            frame_present: true,
                            face_present: landmarks.is_some(),
                            landmarks,
                        };
                        let _ = app.emit(NATIVE_CAMERA_EVENT, event);
                    }
                    Err(error) => {
                        pipeline.reset();
                        set_camera_fault(&app, &shared, "inference", error);
                        ended_with_fault = true;
                        break;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if last_frame.elapsed() >= NATIVE_CAMERA_STALE_AFTER && !stale_reported {
                    stale_reported = true;
                    pipeline.reset();
                    set_camera_status(&app, &shared, "faulted", Some("no_frames".into()));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                set_camera_fault(
                    &app,
                    &shared,
                    "capture",
                    "AVFoundation frame delivery stopped".into(),
                );
                ended_with_fault = true;
                break;
            }
        }
    }

    capture.stop();
    if !ended_with_fault {
        set_camera_status(&app, &shared, "stopped", None);
    }
}

fn record_real_frame(shared: &Arc<Mutex<NativeCameraRuntime>>) -> (u64, u64) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut runtime = shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtime.status.frame_sequence += 1;
    runtime.status.last_frame_at_ms = Some(now_ms);
    runtime.status.state = "running".into();
    runtime.status.fault = None;
    (runtime.status.frame_sequence, now_ms)
}

fn set_camera_fault(
    app: &AppHandle,
    shared: &Arc<Mutex<NativeCameraRuntime>>,
    kind: &str,
    detail: String,
) {
    set_camera_status(app, shared, "faulted", Some(kind.into()));
    eprintln!("native camera {kind} fault: {detail}");
}

fn set_camera_status(
    app: &AppHandle,
    shared: &Arc<Mutex<NativeCameraRuntime>>,
    status: &str,
    fault: Option<String>,
) {
    let payload = {
        let mut runtime = shared
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        runtime.status.state = status.into();
        runtime.status.fault = fault;
        runtime.status.clone()
    };
    let _ = app.emit(NATIVE_CAMERA_STATUS_EVENT, payload);
}

const PACKED_MODELS: &[u8] = include_bytes!(
    "../../../node_modules/@mediapipe/face_mesh/face_mesh_solution_packed_assets.data"
);

// These offsets come from MediaPipe's own
// face_mesh_solution_packed_assets_loader.js in @mediapipe/face_mesh
// 0.4.1633559619. Keeping the slices tied to that exact package makes a model
// substitution visible and testable.
const ATTENTION_LANDMARK_RANGE: std::ops::Range<usize> = 0..2_495_952;
const SHORT_RANGE_DETECTOR_RANGE: std::ops::Range<usize> = 3_757_224..3_986_256;

const TFLITE_OK: i32 = 0;
const TFLITE_FLOAT32: i32 = 1;

#[repr(C)]
struct TfLiteModel {
    _private: [u8; 0],
}

#[repr(C)]
struct TfLiteInterpreterOptions {
    _private: [u8; 0],
}

#[repr(C)]
struct TfLiteInterpreter {
    _private: [u8; 0],
}

#[repr(C)]
struct TfLiteTensor {
    _private: [u8; 0],
}

#[repr(C)]
struct TfLiteRegistration {
    _private: [u8; 0],
}

type ModelCreate = unsafe extern "C" fn(*const c_void, usize) -> *mut TfLiteModel;
type ModelDelete = unsafe extern "C" fn(*mut TfLiteModel);
type OptionsCreate = unsafe extern "C" fn() -> *mut TfLiteInterpreterOptions;
type OptionsDelete = unsafe extern "C" fn(*mut TfLiteInterpreterOptions);
type OptionsSetNumThreads = unsafe extern "C" fn(*mut TfLiteInterpreterOptions, i32);
type OptionsAddCustomOp = unsafe extern "C" fn(
    *mut TfLiteInterpreterOptions,
    *const c_char,
    *const TfLiteRegistration,
    i32,
    i32,
);
type InterpreterCreate = unsafe extern "C" fn(
    *const TfLiteModel,
    *const TfLiteInterpreterOptions,
) -> *mut TfLiteInterpreter;
type InterpreterDelete = unsafe extern "C" fn(*mut TfLiteInterpreter);
type InterpreterAllocateTensors = unsafe extern "C" fn(*mut TfLiteInterpreter) -> i32;
type InterpreterInvoke = unsafe extern "C" fn(*mut TfLiteInterpreter) -> i32;
type InterpreterGetTensorCount = unsafe extern "C" fn(*const TfLiteInterpreter) -> i32;
type InterpreterGetInputTensor =
    unsafe extern "C" fn(*mut TfLiteInterpreter, i32) -> *mut TfLiteTensor;
type InterpreterGetOutputTensor =
    unsafe extern "C" fn(*const TfLiteInterpreter, i32) -> *const TfLiteTensor;
type TensorType = unsafe extern "C" fn(*const TfLiteTensor) -> i32;
type TensorNumDims = unsafe extern "C" fn(*const TfLiteTensor) -> i32;
type TensorDim = unsafe extern "C" fn(*const TfLiteTensor, i32) -> i32;
type TensorByteSize = unsafe extern "C" fn(*const TfLiteTensor) -> usize;
type TensorName = unsafe extern "C" fn(*const TfLiteTensor) -> *const c_char;
type TensorCopyFromBuffer = unsafe extern "C" fn(*mut TfLiteTensor, *const c_void, usize) -> i32;
type TensorCopyToBuffer = unsafe extern "C" fn(*const TfLiteTensor, *mut c_void, usize) -> i32;
type CustomRegistration = unsafe extern "C" fn() -> *const TfLiteRegistration;

#[derive(Clone, Copy)]
struct TfLiteApi {
    model_create: ModelCreate,
    model_delete: ModelDelete,
    options_create: OptionsCreate,
    options_delete: OptionsDelete,
    options_set_num_threads: OptionsSetNumThreads,
    options_add_custom_op: OptionsAddCustomOp,
    interpreter_create: InterpreterCreate,
    interpreter_delete: InterpreterDelete,
    interpreter_allocate_tensors: InterpreterAllocateTensors,
    interpreter_invoke: InterpreterInvoke,
    interpreter_get_input_tensor_count: InterpreterGetTensorCount,
    interpreter_get_input_tensor: InterpreterGetInputTensor,
    interpreter_get_output_tensor_count: InterpreterGetTensorCount,
    interpreter_get_output_tensor: InterpreterGetOutputTensor,
    tensor_type: TensorType,
    tensor_num_dims: TensorNumDims,
    tensor_dim: TensorDim,
    tensor_byte_size: TensorByteSize,
    tensor_name: TensorName,
    tensor_copy_from_buffer: TensorCopyFromBuffer,
    tensor_copy_to_buffer: TensorCopyToBuffer,
}

impl TfLiteApi {
    unsafe fn load(library: &Library) -> Result<Self, String> {
        Ok(Self {
            model_create: symbol(library, b"TfLiteModelCreate\0")?,
            model_delete: symbol(library, b"TfLiteModelDelete\0")?,
            options_create: symbol(library, b"TfLiteInterpreterOptionsCreate\0")?,
            options_delete: symbol(library, b"TfLiteInterpreterOptionsDelete\0")?,
            options_set_num_threads: symbol(library, b"TfLiteInterpreterOptionsSetNumThreads\0")?,
            options_add_custom_op: symbol(library, b"TfLiteInterpreterOptionsAddCustomOp\0")?,
            interpreter_create: symbol(library, b"TfLiteInterpreterCreate\0")?,
            interpreter_delete: symbol(library, b"TfLiteInterpreterDelete\0")?,
            interpreter_allocate_tensors: symbol(library, b"TfLiteInterpreterAllocateTensors\0")?,
            interpreter_invoke: symbol(library, b"TfLiteInterpreterInvoke\0")?,
            interpreter_get_input_tensor_count: symbol(
                library,
                b"TfLiteInterpreterGetInputTensorCount\0",
            )?,
            interpreter_get_input_tensor: symbol(library, b"TfLiteInterpreterGetInputTensor\0")?,
            interpreter_get_output_tensor_count: symbol(
                library,
                b"TfLiteInterpreterGetOutputTensorCount\0",
            )?,
            interpreter_get_output_tensor: symbol(library, b"TfLiteInterpreterGetOutputTensor\0")?,
            tensor_type: symbol(library, b"TfLiteTensorType\0")?,
            tensor_num_dims: symbol(library, b"TfLiteTensorNumDims\0")?,
            tensor_dim: symbol(library, b"TfLiteTensorDim\0")?,
            tensor_byte_size: symbol(library, b"TfLiteTensorByteSize\0")?,
            tensor_name: symbol(library, b"TfLiteTensorName\0")?,
            tensor_copy_from_buffer: symbol(library, b"TfLiteTensorCopyFromBuffer\0")?,
            tensor_copy_to_buffer: symbol(library, b"TfLiteTensorCopyToBuffer\0")?,
        })
    }
}

unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    library
        .get::<T>(name)
        .map(|symbol| *symbol)
        .map_err(|error| format!("missing native MediaPipe symbol: {error}"))
}

#[derive(Debug, PartialEq, Eq)]
struct TensorInfo {
    name: String,
    dimensions: Vec<i32>,
    byte_size: usize,
    element_type: i32,
}

struct NativeModel {
    // Function pointers and custom registrations remain valid only while this
    // handle is alive.
    _library: Library,
    api: TfLiteApi,
    model: NonNull<TfLiteModel>,
    options: NonNull<TfLiteInterpreterOptions>,
    interpreter: NonNull<TfLiteInterpreter>,
}

impl NativeModel {
    fn open(model_bytes: &'static [u8], custom_attention_ops: bool) -> Result<Self, String> {
        let library_path = std::env::var_os("MEDIAPIPE_LIB")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(env!("EUDAIMONIA_MEDIAPIPE_BUILD_LIB")));
        Self::open_from_library(&library_path, model_bytes, custom_attention_ops)
    }

    fn open_from_library(
        library_path: &Path,
        model_bytes: &'static [u8],
        custom_attention_ops: bool,
    ) -> Result<Self, String> {
        // SAFETY: libmediapipe is the pinned official MediaPipe Tasks binary.
        let library = unsafe { Library::new(library_path) }.map_err(|error| error.to_string())?;
        // SAFETY: every loaded signature is declared by TensorFlow Lite's C API.
        let api = unsafe { TfLiteApi::load(&library)? };
        let model = NonNull::new(unsafe {
            (api.model_create)(model_bytes.as_ptr().cast(), model_bytes.len())
        })
        .ok_or("TensorFlow Lite rejected the model flatbuffer")?;
        let options = match NonNull::new(unsafe { (api.options_create)() }) {
            Some(options) => options,
            None => {
                unsafe { (api.model_delete)(model.as_ptr()) };
                return Err("TensorFlow Lite could not create interpreter options".into());
            }
        };

        unsafe { (api.options_set_num_threads)(options.as_ptr(), 2) };
        if custom_attention_ops {
            if let Err(error) = unsafe { register_attention_ops(&library, &api, options) } {
                unsafe {
                    (api.options_delete)(options.as_ptr());
                    (api.model_delete)(model.as_ptr());
                }
                return Err(error);
            }
        }

        let interpreter = match NonNull::new(unsafe {
            (api.interpreter_create)(model.as_ptr(), options.as_ptr())
        }) {
            Some(interpreter) => interpreter,
            None => {
                unsafe {
                    (api.options_delete)(options.as_ptr());
                    (api.model_delete)(model.as_ptr());
                }
                return Err("TensorFlow Lite could not create the interpreter".into());
            }
        };
        if unsafe { (api.interpreter_allocate_tensors)(interpreter.as_ptr()) } != TFLITE_OK {
            unsafe {
                (api.interpreter_delete)(interpreter.as_ptr());
                (api.options_delete)(options.as_ptr());
                (api.model_delete)(model.as_ptr());
            }
            return Err("TensorFlow Lite could not allocate model tensors".into());
        }

        Ok(Self {
            _library: library,
            api,
            model,
            options,
            interpreter,
        })
    }

    fn input_info(&self, index: i32) -> Result<TensorInfo, String> {
        let count =
            unsafe { (self.api.interpreter_get_input_tensor_count)(self.interpreter.as_ptr()) };
        if index < 0 || index >= count {
            return Err(format!("input tensor index {index} is outside 0..{count}"));
        }
        let tensor =
            unsafe { (self.api.interpreter_get_input_tensor)(self.interpreter.as_ptr(), index) };
        self.tensor_info(tensor.cast_const())
    }

    fn output_infos(&self) -> Result<Vec<TensorInfo>, String> {
        let count =
            unsafe { (self.api.interpreter_get_output_tensor_count)(self.interpreter.as_ptr()) };
        (0..count)
            .map(|index| {
                let tensor = unsafe {
                    (self.api.interpreter_get_output_tensor)(self.interpreter.as_ptr(), index)
                };
                self.tensor_info(tensor)
            })
            .collect()
    }

    fn tensor_info(&self, tensor: *const TfLiteTensor) -> Result<TensorInfo, String> {
        let tensor =
            NonNull::new(tensor.cast_mut()).ok_or("TensorFlow Lite returned a null tensor")?;
        let dimensions = (0..unsafe { (self.api.tensor_num_dims)(tensor.as_ptr()) })
            .map(|dimension| unsafe { (self.api.tensor_dim)(tensor.as_ptr(), dimension) })
            .collect();
        let name = unsafe { (self.api.tensor_name)(tensor.as_ptr()) };
        let name = if name.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned()
        };
        Ok(TensorInfo {
            name,
            dimensions,
            byte_size: unsafe { (self.api.tensor_byte_size)(tensor.as_ptr()) },
            element_type: unsafe { (self.api.tensor_type)(tensor.as_ptr()) },
        })
    }

    fn invoke_f32(&mut self, input: &[f32]) -> Result<Vec<Vec<f32>>, String> {
        let input_tensor =
            unsafe { (self.api.interpreter_get_input_tensor)(self.interpreter.as_ptr(), 0) };
        let input_info = self.tensor_info(input_tensor.cast_const())?;
        if input_info.element_type != TFLITE_FLOAT32 {
            return Err(format!(
                "model input is not float32: {}",
                input_info.element_type
            ));
        }
        let input_bytes = std::mem::size_of_val(input);
        if input_bytes != input_info.byte_size {
            return Err(format!(
                "input has {input_bytes} bytes; model expects {}",
                input_info.byte_size
            ));
        }
        if unsafe {
            (self.api.tensor_copy_from_buffer)(input_tensor, input.as_ptr().cast(), input_bytes)
        } != TFLITE_OK
        {
            return Err("TensorFlow Lite rejected the input buffer".into());
        }
        if unsafe { (self.api.interpreter_invoke)(self.interpreter.as_ptr()) } != TFLITE_OK {
            return Err("TensorFlow Lite inference failed".into());
        }

        self.output_infos()?
            .into_iter()
            .enumerate()
            .map(|(index, info)| {
                if info.element_type != TFLITE_FLOAT32 {
                    return Err(format!(
                        "output {index} is not float32: {}",
                        info.element_type
                    ));
                }
                let mut values = vec![0.0_f32; info.byte_size / std::mem::size_of::<f32>()];
                let tensor = unsafe {
                    (self.api.interpreter_get_output_tensor)(
                        self.interpreter.as_ptr(),
                        index as i32,
                    )
                };
                if unsafe {
                    (self.api.tensor_copy_to_buffer)(
                        tensor,
                        values.as_mut_ptr().cast(),
                        info.byte_size,
                    )
                } != TFLITE_OK
                {
                    return Err(format!("TensorFlow Lite could not copy output {index}"));
                }
                Ok(values)
            })
            .collect()
    }
}

impl Drop for NativeModel {
    fn drop(&mut self) {
        unsafe {
            (self.api.interpreter_delete)(self.interpreter.as_ptr());
            (self.api.options_delete)(self.options.as_ptr());
            (self.api.model_delete)(self.model.as_ptr());
        }
    }
}

unsafe fn register_attention_ops(
    library: &Library,
    api: &TfLiteApi,
    options: NonNull<TfLiteInterpreterOptions>,
) -> Result<(), String> {
    const REGISTRATIONS: [(&[u8], &[u8]); 3] = [
        (
            b"Landmarks2TransformMatrix\0",
            b"_ZN9mediapipe17tflite_operations36RegisterLandmarksToTransformMatrixV2Ev\0",
        ),
        (
            b"TransformTensorBilinear\0",
            b"_ZN9mediapipe17tflite_operations33RegisterTransformTensorBilinearV2Ev\0",
        ),
        (
            b"TransformLandmarks\0",
            b"_ZN9mediapipe17tflite_operations28RegisterTransformLandmarksV2Ev\0",
        ),
    ];

    for (name, registration_symbol) in REGISTRATIONS {
        let registration: CustomRegistration = symbol(library, registration_symbol)?;
        let registration = registration();
        if registration.is_null() {
            return Err(format!(
                "MediaPipe returned no registration for {}",
                CStr::from_bytes_with_nul(name)
                    .expect("static custom-op name")
                    .to_string_lossy()
            ));
        }
        (api.options_add_custom_op)(options.as_ptr(), name.as_ptr().cast(), registration, 2, 2);
    }
    Ok(())
}

fn attention_landmark_model() -> &'static [u8] {
    &PACKED_MODELS[ATTENTION_LANDMARK_RANGE]
}

fn short_range_detector_model() -> &'static [u8] {
    &PACKED_MODELS[SHORT_RANGE_DETECTOR_RANGE]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_status_starts_explicitly_stopped() {
        let status = NativeCameraStatus::default();
        assert_eq!(status.state, "stopped");
        assert!(status.fault.is_none());
        assert_eq!(status.frame_sequence, 0);
        assert!(status.last_frame_at_ms.is_none());
    }

    #[test]
    fn extracts_the_exact_attention_model_from_the_bundled_solution() {
        let bytes = attention_landmark_model();
        assert_eq!(bytes.len(), 2_495_952);
        assert_eq!(&bytes[4..8], b"TFL3");
    }

    #[test]
    fn extracts_the_matching_short_range_detector_from_the_same_bundle() {
        let bytes = short_range_detector_model();
        assert_eq!(bytes.len(), 229_032);
        assert_eq!(&bytes[4..8], b"TFL3");
    }

    #[test]
    fn loads_and_invokes_the_exact_legacy_attention_graph() {
        let mut model = NativeModel::open(attention_landmark_model(), true)
            .expect("legacy attention model and MediaPipe custom ops");
        let input = model.input_info(0).expect("attention input tensor");
        assert_eq!(input.dimensions, vec![1, 192, 192, 3]);
        assert_eq!(input.element_type, TFLITE_FLOAT32);

        let output_dimensions: Vec<Vec<i32>> = model
            .output_infos()
            .expect("attention output tensors")
            .into_iter()
            .map(|tensor| tensor.dimensions)
            .collect();
        assert_eq!(
            output_dimensions,
            vec![
                vec![1, 1, 1, 1404],
                vec![1, 1, 1, 160],
                vec![1, 1, 1, 142],
                vec![1, 1, 1, 142],
                vec![1, 1, 1, 10],
                vec![1, 1, 1, 10],
                vec![1, 1, 1, 1],
            ]
        );

        let values = model
            .invoke_f32(&vec![0.0; 192 * 192 * 3])
            .expect("native attention inference");
        assert_eq!(values.len(), 7);
        assert!(values.iter().flatten().all(|value| value.is_finite()));
    }

    #[test]
    fn loads_and_invokes_the_matching_legacy_detector_graph() {
        let mut model = NativeModel::open(short_range_detector_model(), false)
            .expect("legacy short-range detector model");
        let input = model.input_info(0).expect("detector input tensor");
        assert_eq!(input.dimensions, vec![1, 128, 128, 3]);
        let output_dimensions: Vec<Vec<i32>> = model
            .output_infos()
            .expect("detector output tensors")
            .into_iter()
            .map(|tensor| tensor.dimensions)
            .collect();
        assert_eq!(output_dimensions, vec![vec![1, 896, 16], vec![1, 896, 1]]);

        let values = model
            .invoke_f32(&vec![0.0; 128 * 128 * 3])
            .expect("native detector inference");
        assert_eq!(values.len(), 2);
        assert!(values.iter().flatten().all(|value| value.is_finite()));
    }
}
