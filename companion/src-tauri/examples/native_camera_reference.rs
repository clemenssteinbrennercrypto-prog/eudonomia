#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn main() {
    let mut arguments = std::env::args_os().skip(1);
    let frames = arguments.next().unwrap_or_else(|| usage());
    let output = arguments.next().unwrap_or_else(|| usage());
    if arguments.next().is_some() {
        usage();
    }
    match eudonomia_companion::native_camera::run_reference_harness(frames, output) {
        Ok(summary) => println!(
            "native frames: {}, faces: {}, output: {}",
            summary.frames,
            summary.frames_with_face,
            summary.output.display()
        ),
        Err(error) => {
            eprintln!("native camera reference harness failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn main() {
    eprintln!("native camera reference harness requires macOS arm64");
    std::process::exit(1);
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn usage() -> ! {
    eprintln!("usage: native_camera_reference <frames-directory> <output.jsonl>");
    std::process::exit(2);
}
