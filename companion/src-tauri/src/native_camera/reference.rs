//! Explicit, local-only recorded-frame runner for the parity gate.

use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;

use super::pipeline::{analyze_landmarks, FrameSignals, Landmark, NativeFacePipeline, RgbFrame};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceHarnessSummary {
    pub frames: usize,
    pub frames_with_face: usize,
    pub output: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceFrameRecord {
    frame_index: usize,
    file_name: String,
    frame_measured: bool,
    face_present: bool,
    landmarks: Option<Vec<Landmark>>,
    signals: Option<FrameSignals>,
    // Scoring intentionally remains absent until the shared replay scorer is
    // extracted. A null cannot be mistaken for a parity result.
    attention_score: Option<f32>,
}

pub fn run_reference_harness(
    frames_directory: impl AsRef<Path>,
    output_jsonl: impl AsRef<Path>,
) -> Result<ReferenceHarnessSummary, String> {
    let frames_directory = frames_directory.as_ref();
    let output_jsonl = output_jsonl.as_ref();
    let mut paths: Vec<PathBuf> = fs::read_dir(frames_directory)
        .map_err(|error| format!("read {}: {error}", frames_directory.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "png" | "jpg" | "jpeg"
                    )
                })
        })
        .collect();
    paths.sort();
    if paths.is_empty() {
        return Err(format!(
            "no PNG or JPEG frames in {}",
            frames_directory.display()
        ));
    }

    let output = File::create(output_jsonl)
        .map_err(|error| format!("create {}: {error}", output_jsonl.display()))?;
    let mut output = BufWriter::new(output);
    let mut pipeline = NativeFacePipeline::new()?;
    let mut frames_with_face = 0;

    for (frame_index, path) in paths.iter().enumerate() {
        let decoded = image::ImageReader::open(path)
            .map_err(|error| format!("open {}: {error}", path.display()))?
            .decode()
            .map_err(|error| format!("decode {}: {error}", path.display()))?
            .into_rgb8();
        let frame = RgbFrame {
            width: decoded.width() as usize,
            height: decoded.height() as usize,
            pixels: decoded.into_raw(),
        };
        let landmarks = pipeline
            .process(&frame)
            .map_err(|error| format!("analyze {}: {error}", path.display()))?;
        if landmarks.is_some() {
            frames_with_face += 1;
        }
        let signals = landmarks.as_deref().and_then(analyze_landmarks);
        let record = ReferenceFrameRecord {
            frame_index,
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_owned(),
            frame_measured: true,
            face_present: landmarks.is_some(),
            landmarks,
            signals,
            attention_score: None,
        };
        serde_json::to_writer(&mut output, &record).map_err(|error| error.to_string())?;
        output.write_all(b"\n").map_err(|error| error.to_string())?;
    }
    output.flush().map_err(|error| error.to_string())?;

    Ok(ReferenceHarnessSummary {
        frames: paths.len(),
        frames_with_face,
        output: output_jsonl.to_path_buf(),
    })
}
