//! AVFoundation frame capture.
//!
//! The delegate copies each BGRA pixel buffer immediately and never retains a
//! CMSampleBuffer. A bounded channel keeps inference back-pressure from growing
//! memory: if processing is late, at most one camera frame waits in the
//! bounded queue. Frames are never written to disk here.

use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};

use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, ProtocolObject},
    AnyThread, DefinedClass,
};
use objc2_av_foundation::{
    AVCaptureConnection, AVCaptureDevice, AVCaptureDeviceInput, AVCaptureInput, AVCaptureOutput,
    AVCaptureSession, AVCaptureSessionPreset640x480, AVCaptureVideoDataOutput,
    AVCaptureVideoDataOutputSampleBufferDelegate, AVMediaTypeVideo,
};
use objc2_core_media::CMSampleBuffer;
use objc2_core_video::{
    kCVPixelFormatType_32BGRA, CVPixelBuffer, CVPixelBufferGetBaseAddress,
    CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight, CVPixelBufferGetWidth,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSObjectProtocol, NSString};

use super::pipeline::RgbFrame;

struct CaptureDelegateIvars {
    sender: SyncSender<RgbFrame>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "EudonomiaNativeCameraDelegate"]
    #[ivars = CaptureDelegateIvars]
    struct CaptureDelegate;

    unsafe impl NSObjectProtocol for CaptureDelegate {}

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for CaptureDelegate {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn capture_output(
            &self,
            _output: &AVCaptureOutput,
            sample_buffer: &CMSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            let Some(image_buffer) = (unsafe { sample_buffer.image_buffer() }) else {
                return;
            };
            let pixel_buffer: &CVPixelBuffer = &image_buffer;
            let flags = CVPixelBufferLockFlags::ReadOnly;
            if unsafe { CVPixelBufferLockBaseAddress(pixel_buffer, flags) } != 0 {
                return;
            }
            let frame = copy_bgra_frame(pixel_buffer);
            unsafe { CVPixelBufferUnlockBaseAddress(pixel_buffer, flags) };
            if let Some(frame) = frame {
                match self.ivars().sender.try_send(frame) {
                    Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
                }
            }
        }
    }
);

impl CaptureDelegate {
    fn new(sender: SyncSender<RgbFrame>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(CaptureDelegateIvars { sender });
        unsafe { msg_send![super(this), init] }
    }
}

pub(super) struct NativeCapture {
    session: Retained<AVCaptureSession>,
    _input: Retained<AVCaptureDeviceInput>,
    output: Retained<AVCaptureVideoDataOutput>,
    _delegate: Retained<CaptureDelegate>,
    _queue: DispatchRetained<DispatchQueue>,
}

impl NativeCapture {
    pub fn start() -> Result<(Self, Receiver<RgbFrame>), String> {
        let media_type = unsafe { AVMediaTypeVideo }.ok_or("AVMediaTypeVideo is unavailable")?;
        let device = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(media_type) }
            .ok_or("no macOS camera is available")?;
        let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }
            .map_err(|error| error.localizedDescription().to_string())?;
        let session = unsafe { AVCaptureSession::new() };
        let output = unsafe { AVCaptureVideoDataOutput::new() };
        let (sender, receiver) = mpsc::sync_channel(1);
        let delegate = CaptureDelegate::new(sender);
        let queue = DispatchQueue::new("at.eudonomia.native-camera", None);

        unsafe {
            session.beginConfiguration();
            session.setSessionPreset(AVCaptureSessionPreset640x480);
        }
        if !unsafe { session.canAddInput(&input) } {
            unsafe { session.commitConfiguration() };
            return Err("AVFoundation rejected the selected camera input".into());
        }
        if !unsafe { session.canAddOutput(&output) } {
            unsafe { session.commitConfiguration() };
            return Err("AVFoundation rejected the video frame output".into());
        }

        let pixel_format_key = NSString::from_str("PixelFormatType");
        let pixel_format = NSNumber::new_u32(kCVPixelFormatType_32BGRA);
        let pixel_format_value: &AnyObject = &pixel_format;
        let settings: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[&*pixel_format_key], &[pixel_format_value]);
        let delegate_protocol: &ProtocolObject<dyn AVCaptureVideoDataOutputSampleBufferDelegate> =
            ProtocolObject::from_ref(&*delegate);
        unsafe {
            output.setVideoSettings(Some(&settings));
            output.setAlwaysDiscardsLateVideoFrames(true);
            session.addInput(&input as &AVCaptureInput);
            session.addOutput(&output);
            output.setSampleBufferDelegate_queue(Some(delegate_protocol), Some(&queue));
            session.commitConfiguration();
            session.startRunning();
        }

        Ok((
            Self {
                session,
                _input: input,
                output,
                _delegate: delegate,
                _queue: queue,
            },
            receiver,
        ))
    }

    pub fn stop(&self) {
        unsafe {
            self.output.setSampleBufferDelegate_queue(None, None);
            self.session.stopRunning();
        }
    }
}

impl Drop for NativeCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn copy_bgra_frame(pixel_buffer: &CVPixelBuffer) -> Option<RgbFrame> {
    let width = CVPixelBufferGetWidth(pixel_buffer);
    let height = CVPixelBufferGetHeight(pixel_buffer);
    let bytes_per_row = CVPixelBufferGetBytesPerRow(pixel_buffer);
    let base = CVPixelBufferGetBaseAddress(pixel_buffer).cast::<u8>();
    if width == 0 || height == 0 || base.is_null() || bytes_per_row < width.checked_mul(4)? {
        return None;
    }
    let mut pixels = vec![0_u8; width.checked_mul(height)?.checked_mul(3)?];
    for y in 0..height {
        let source = unsafe { std::slice::from_raw_parts(base.add(y * bytes_per_row), width * 4) };
        let target = &mut pixels[y * width * 3..(y + 1) * width * 3];
        for x in 0..width {
            target[x * 3] = source[x * 4 + 2];
            target[x * 3 + 1] = source[x * 4 + 1];
            target[x * 3 + 2] = source[x * 4];
        }
    }
    Some(RgbFrame {
        width,
        height,
        pixels,
    })
}
