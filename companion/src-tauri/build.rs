fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    assert!(
        target_os == "macos" && target_arch == "aarch64",
        "Eudonomia Companion supports Apple Silicon macOS only (aarch64-apple-darwin)"
    );
    #[cfg(target_os = "macos")]
    prepare_native_mediapipe();
    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn prepare_native_mediapipe() {
    use sha2::{Digest, Sha256};
    use std::{env, fs, path::PathBuf};

    const EXPECTED_LIBRARY_SHA256: &str =
        "f183acadefa74df7d9651beb3ff8339320c544020920e8d9038637f50bfdd453";

    let source = mediapipe::loader::lib()
        .expect("download the pinned official MediaPipe 0.10.35 wheel")
        .source
        .path()
        .to_path_buf();
    let source_bytes = fs::read(&source).expect("read the pinned MediaPipe library");
    let source_digest = format!("{:x}", Sha256::digest(&source_bytes));
    assert_eq!(
        source_digest, EXPECTED_LIBRARY_SHA256,
        "the extracted MediaPipe library does not match the reviewed arm64 binary"
    );

    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let destination = manifest_dir.join("resources/libmediapipe.dylib");
    fs::create_dir_all(destination.parent().expect("resource directory"))
        .expect("create native camera resource directory");
    let destination_matches = fs::read(&destination)
        .ok()
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)) == EXPECTED_LIBRARY_SHA256)
        .unwrap_or(false);
    if !destination_matches {
        fs::write(&destination, source_bytes).expect("copy MediaPipe into app resources");
    }

    println!(
        "cargo:rustc-env=EUDAIMONIA_MEDIAPIPE_BUILD_LIB={}",
        destination.display()
    );
}
