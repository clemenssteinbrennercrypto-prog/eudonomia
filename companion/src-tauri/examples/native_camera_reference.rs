#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn main() {
    let mut arguments = std::env::args_os().skip(1);
    let frames = arguments.next().unwrap_or_else(|| usage());
    let output = arguments.next().unwrap_or_else(|| usage());
    let oracle = match arguments.next() {
        None => None,
        Some(flag) if flag == "--roi-oracle" => Some(arguments.next().unwrap_or_else(|| usage())),
        Some(_) => usage(),
    };
    if arguments.next().is_some() {
        usage();
    }
    let result = if let Some(oracle) = oracle {
        eudonomia_companion::native_camera::run_reference_harness_with_roi_oracle(
            frames, output, oracle,
        )
    } else {
        eudonomia_companion::native_camera::run_reference_harness(frames, output)
    };
    match result {
        Ok(summary) => println!(
            "native frames: {}, faces: {}, ROI oracle: {}, output: {}",
            summary.frames,
            summary.frames_with_face,
            summary.used_reference_roi,
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
    eprintln!(
        "usage: native_camera_reference <frames-directory> <output.jsonl> [--roi-oracle <facemesh-js.jsonl>]"
    );
    std::process::exit(2);
}
