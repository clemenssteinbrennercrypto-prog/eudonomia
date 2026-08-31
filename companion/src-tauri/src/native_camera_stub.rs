//! Non-arm64 build stub. Native FaceMesh is intentionally arm64-only because
//! the target machine and the pinned official MediaPipe binary are arm64.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Clone, Default)]
pub struct NativeCameraState;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCameraStatus {
    state: String,
    fault: Option<String>,
    frame_sequence: u64,
    last_frame_at_ms: Option<u64>,
}

#[tauri::command]
pub fn get_native_camera_status(_state: State<'_, NativeCameraState>) -> NativeCameraStatus {
    NativeCameraStatus {
        state: "unsupported".into(),
        fault: Some("architecture".into()),
        ..NativeCameraStatus::default()
    }
}

#[tauri::command]
pub fn start_native_camera_prototype(
    _state: State<'_, NativeCameraState>,
) -> Result<NativeCameraStatus, String> {
    Err("native camera prototype requires macOS arm64".into())
}

#[tauri::command]
pub fn stop_native_camera_prototype(_state: State<'_, NativeCameraState>) -> NativeCameraStatus {
    get_native_camera_status(_state)
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct NativeCameraPreviewBounds {
    right: f64,
    bottom: f64,
    width: f64,
    height: f64,
    visible: bool,
    corner_radius: f64,
}

#[tauri::command]
pub fn set_native_camera_preview(
    _app: AppHandle,
    bounds: NativeCameraPreviewBounds,
) -> Result<(), String> {
    let _ = bounds;
    Err("native camera preview requires macOS arm64".into())
}
