#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub mod native_camera;
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
compile_error!("Eudonomia Companion supports Apple Silicon macOS only (aarch64-apple-darwin)");
