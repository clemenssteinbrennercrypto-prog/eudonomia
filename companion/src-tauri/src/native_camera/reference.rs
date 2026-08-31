//! Explicit, local-only recorded-frame runner for the parity gate.

use std::{
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::pipeline::{analyze_landmarks, FrameSignals, Landmark, NativeFacePipeline, RgbFrame};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceHarnessSummary {
    pub frames: usize,
    pub frames_with_face: usize,
    pub output: PathBuf,
    pub used_reference_roi: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoiOracleFrame {
    frame_index: usize,
    file_name: String,
    face_present: bool,
    landmarks: Option<Vec<Landmark>>,
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
    run_reference_harness_inner(frames_directory.as_ref(), output_jsonl.as_ref(), None)
}

/// Runs the recorded-frame harness while deriving each tracking ROI from the
/// reference engine's preceding-frame landmarks. This is a diagnostic oracle,
/// not an alternate production path or a valid standalone parity result.
pub fn run_reference_harness_with_roi_oracle(
    frames_directory: impl AsRef<Path>,
    output_jsonl: impl AsRef<Path>,
    oracle_jsonl: impl AsRef<Path>,
) -> Result<ReferenceHarnessSummary, String> {
    let oracle = read_roi_oracle(oracle_jsonl.as_ref())?;
    run_reference_harness_inner(
        frames_directory.as_ref(),
        output_jsonl.as_ref(),
        Some(&oracle),
    )
}

fn run_reference_harness_inner(
    frames_directory: &Path,
    output_jsonl: &Path,
    roi_oracle: Option<&[RoiOracleFrame]>,
) -> Result<ReferenceHarnessSummary, String> {
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
    if let Some(oracle) = roi_oracle {
        validate_roi_oracle(&paths, oracle)?;
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
        if let Some(previous) =
            roi_oracle.and_then(|oracle| frame_index.checked_sub(1).map(|i| &oracle[i]))
        {
            match (previous.face_present, previous.landmarks.as_deref()) {
                (true, Some(landmarks)) => pipeline
                    .set_reference_roi(landmarks, frame.width, frame.height)
                    .map_err(|error| {
                        format!("ROI oracle frame {}: {error}", previous.frame_index)
                    })?,
                (false, None) => pipeline.reset(),
                _ => {
                    return Err(format!(
                        "ROI oracle frame {} has inconsistent facePresent/landmarks",
                        previous.frame_index
                    ));
                }
            }
        }
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
        used_reference_roi: roi_oracle.is_some(),
    })
}

fn read_roi_oracle(path: &Path) -> Result<Vec<RoiOracleFrame>, String> {
    let input = File::open(path).map_err(|error| format!("open {}: {error}", path.display()))?;
    BufReader::new(input)
        .lines()
        .enumerate()
        .map(|(line_index, line)| {
            let line = line.map_err(|error| {
                format!("read {} line {}: {error}", path.display(), line_index + 1)
            })?;
            serde_json::from_str(&line).map_err(|error| {
                format!("parse {} line {}: {error}", path.display(), line_index + 1)
            })
        })
        .collect()
}

fn validate_roi_oracle(paths: &[PathBuf], oracle: &[RoiOracleFrame]) -> Result<(), String> {
    if paths.len() != oracle.len() {
        return Err(format!(
            "ROI oracle has {} frames; image directory has {}",
            oracle.len(),
            paths.len()
        ));
    }
    for (frame_index, (path, reference)) in paths.iter().zip(oracle).enumerate() {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if reference.frame_index != frame_index || reference.file_name != file_name {
            return Err(format!(
                "ROI oracle frame {frame_index} is {}/{}; expected {frame_index}/{file_name}",
                reference.frame_index, reference.file_name
            ));
        }
    }
    Ok(())
}
