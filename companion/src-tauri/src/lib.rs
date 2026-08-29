#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub mod native_camera;
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
#[path = "native_camera_stub.rs"]
pub mod native_camera;
