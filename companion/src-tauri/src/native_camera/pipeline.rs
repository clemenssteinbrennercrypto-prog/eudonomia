//! Legacy FaceMesh preprocessing and postprocessing.
//!
//! The constants and transforms in this file mirror MediaPipe v0.8.9's
//! `face_detection_short_range_common.pbtxt`, `face_landmark_cpu.pbtxt`, and
//! `tensors_to_face_landmarks_with_attention.pbtxt`. That release matches the
//! timestamped @mediapipe/face_mesh package used by the WebView. Do not tune
//! these values to make parity pass; a mismatch belongs in the transform.

use serde::Serialize;

use super::{attention_landmark_model, short_range_detector_model, NativeModel};

const DETECTOR_SIZE: usize = 128;
const LANDMARK_SIZE: usize = 192;
const FACE_CONFIDENCE_THRESHOLD: f32 = 0.5;
const NMS_IOU_THRESHOLD: f32 = 0.3;
const ROI_SCALE: f32 = 1.5;

const LIPS_MAPPING: [usize; 80] = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409, 78,
    95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415, 76, 77,
    90, 180, 85, 16, 315, 404, 320, 307, 306, 184, 74, 73, 72, 11, 302, 303, 304, 408, 62, 96, 89,
    179, 86, 15, 316, 403, 319, 325, 292, 183, 42, 41, 38, 12, 268, 271, 272, 407,
];

const LEFT_EYE_MAPPING: [usize; 71] = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173, 130, 25, 110, 24,
    23, 22, 26, 112, 243, 247, 30, 29, 27, 28, 56, 190, 226, 31, 228, 229, 230, 231, 232, 233, 244,
    113, 225, 224, 223, 222, 221, 189, 35, 124, 46, 53, 52, 65, 143, 111, 117, 118, 119, 120, 121,
    128, 245, 156, 70, 63, 105, 66, 107, 55, 193,
];

const RIGHT_EYE_MAPPING: [usize; 71] = [
    263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398, 359, 255, 339,
    254, 253, 252, 256, 341, 463, 467, 260, 259, 257, 258, 286, 414, 446, 261, 448, 449, 450, 451,
    452, 453, 464, 342, 445, 444, 443, 442, 441, 413, 265, 353, 276, 283, 282, 295, 372, 340, 346,
    347, 348, 349, 350, 357, 465, 383, 300, 293, 334, 296, 336, 285, 417,
];

const LEFT_IRIS_Z_AVERAGE: [usize; 16] = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
];

const RIGHT_IRIS_Z_AVERAGE: [usize; 16] = [
    263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398,
];

#[derive(Debug, Clone)]
pub(super) struct RgbFrame {
    pub width: usize,
    pub height: usize,
    /// Interleaved RGB8, top row first. Frames exist only in memory.
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Landmark {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FrameSignals {
    pub right_ear: f32,
    pub left_ear: f32,
    pub average_ear: f32,
    pub yaw_signed: f32,
    pub pitch_deg: f32,
    pub pitch_up_deg: f32,
    pub iris_h: f32,
}

#[derive(Debug, Clone, Copy)]
struct Roi {
    x_center: f32,
    y_center: f32,
    width: f32,
    height: f32,
    /// Clockwise radians in the image's y-down coordinate system.
    rotation: f32,
}

#[derive(Debug, Clone)]
struct Detection {
    score: f32,
    // xmin, ymin, xmax, ymax followed by six keypoints as x/y pairs.
    values: [f32; 16],
}

pub(super) struct NativeFacePipeline {
    detector: NativeModel,
    landmarker: NativeModel,
    previous_roi: Option<Roi>,
}

impl NativeFacePipeline {
    pub fn new() -> Result<Self, String> {
        let detector = NativeModel::open(short_range_detector_model(), false)?;
        let landmarker = NativeModel::open(attention_landmark_model(), true)?;
        if detector.input_info(0)?.dimensions != [1, 128, 128, 3] {
            return Err("legacy detector input shape changed".into());
        }
        if landmarker.input_info(0)?.dimensions != [1, 192, 192, 3] {
            return Err("legacy attention input shape changed".into());
        }
        Ok(Self {
            detector,
            landmarker,
            previous_roi: None,
        })
    }

    pub fn reset(&mut self) {
        self.previous_roi = None;
    }

    pub fn process(&mut self, frame: &RgbFrame) -> Result<Option<Vec<Landmark>>, String> {
        frame.validate()?;
        let roi = match self.previous_roi {
            Some(roi) => roi,
            None => match self.detect_roi(frame)? {
                Some(roi) => roi,
                None => return Ok(None),
            },
        };

        let tensor = image_to_tensor(frame, roi, LANDMARK_SIZE, 0.0, 1.0);
        let outputs = self.landmarker.invoke_f32(&tensor)?;
        let face_score = sigmoid(outputs[6][0]);
        if face_score < FACE_CONFIDENCE_THRESHOLD {
            self.previous_roi = None;
            return Ok(None);
        }

        let landmarks = refine_and_project_landmarks(&outputs, roi)?;
        self.previous_roi = roi_from_landmarks(&landmarks, frame.width, frame.height);
        Ok(Some(landmarks))
    }

    fn detect_roi(&mut self, frame: &RgbFrame) -> Result<Option<Roi>, String> {
        let full_image_roi = square_long_roi(frame.width, frame.height);
        let tensor = image_to_tensor(frame, full_image_roi, DETECTOR_SIZE, -1.0, 1.0);
        let outputs = self.detector.invoke_f32(&tensor)?;
        let detections = decode_detections(&outputs, full_image_roi)?;
        Ok(weighted_nms(detections)
            .first()
            .map(|detection| roi_from_detection(detection, frame.width, frame.height)))
    }
}

impl RgbFrame {
    fn validate(&self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 {
            return Err("camera frame has zero width or height".into());
        }
        let expected = self
            .width
            .checked_mul(self.height)
            .and_then(|pixels| pixels.checked_mul(3))
            .ok_or("camera frame dimensions overflow")?;
        if self.pixels.len() != expected {
            return Err(format!(
                "camera frame has {} bytes; expected {expected}",
                self.pixels.len()
            ));
        }
        Ok(())
    }
}

fn square_long_roi(width: usize, height: usize) -> Roi {
    let long = width.max(height) as f32;
    Roi {
        x_center: 0.5,
        y_center: 0.5,
        width: long / width as f32,
        height: long / height as f32,
        rotation: 0.0,
    }
}

fn image_to_tensor(
    frame: &RgbFrame,
    roi: Roi,
    output_size: usize,
    range_min: f32,
    range_max: f32,
) -> Vec<f32> {
    let mut tensor = vec![0.0; output_size * output_size * 3];
    let sin = roi.rotation.sin();
    let cos = roi.rotation.cos();
    let range_scale = (range_max - range_min) / 255.0;

    for output_y in 0..output_size {
        let relative_y = (output_y as f32 + 0.5) / output_size as f32 - 0.5;
        for output_x in 0..output_size {
            let relative_x = (output_x as f32 + 0.5) / output_size as f32 - 0.5;
            let source_x_normalized =
                roi.x_center + relative_x * roi.width * cos - relative_y * roi.height * sin;
            let source_y_normalized =
                roi.y_center + relative_x * roi.width * sin + relative_y * roi.height * cos;
            let source_x = source_x_normalized * frame.width as f32 - 0.5;
            let source_y = source_y_normalized * frame.height as f32 - 0.5;
            let rgb = bilinear_rgb(frame, source_x, source_y);
            let offset = (output_y * output_size + output_x) * 3;
            for channel in 0..3 {
                tensor[offset + channel] = rgb[channel] * range_scale + range_min;
            }
        }
    }
    tensor
}

fn bilinear_rgb(frame: &RgbFrame, x: f32, y: f32) -> [f32; 3] {
    let x0 = x.floor() as isize;
    let y0 = y.floor() as isize;
    let x_fraction = x - x0 as f32;
    let y_fraction = y - y0 as f32;
    let mut result = [0.0; 3];
    for (sample_x, x_weight) in [(x0, 1.0 - x_fraction), (x0 + 1, x_fraction)] {
        for (sample_y, y_weight) in [(y0, 1.0 - y_fraction), (y0 + 1, y_fraction)] {
            if sample_x < 0
                || sample_y < 0
                || sample_x >= frame.width as isize
                || sample_y >= frame.height as isize
            {
                continue;
            }
            let offset = (sample_y as usize * frame.width + sample_x as usize) * 3;
            let weight = x_weight * y_weight;
            for (channel, value) in result.iter_mut().enumerate() {
                *value += frame.pixels[offset + channel] as f32 * weight;
            }
        }
    }
    result
}

fn decode_detections(outputs: &[Vec<f32>], projection: Roi) -> Result<Vec<Detection>, String> {
    if outputs.len() != 2 || outputs[0].len() != 896 * 16 || outputs[1].len() != 896 {
        return Err("legacy face detector returned unexpected tensor shapes".into());
    }
    let anchors = detector_anchors();
    let mut detections = Vec::new();
    for (index, anchor) in anchors.iter().enumerate() {
        let score = sigmoid(outputs[1][index].clamp(-100.0, 100.0));
        if score < FACE_CONFIDENCE_THRESHOLD {
            continue;
        }
        let raw = &outputs[0][index * 16..(index + 1) * 16];
        let center = project_point(
            raw[0] / DETECTOR_SIZE as f32 + anchor.0,
            raw[1] / DETECTOR_SIZE as f32 + anchor.1,
            projection,
        );
        let half_width = raw[2] / DETECTOR_SIZE as f32 / 2.0 * projection.width;
        let half_height = raw[3] / DETECTOR_SIZE as f32 / 2.0 * projection.height;
        let mut values = [0.0; 16];
        values[0] = center.0 - half_width;
        values[1] = center.1 - half_height;
        values[2] = center.0 + half_width;
        values[3] = center.1 + half_height;
        for keypoint in 0..6 {
            let point = project_point(
                raw[4 + keypoint * 2] / DETECTOR_SIZE as f32 + anchor.0,
                raw[5 + keypoint * 2] / DETECTOR_SIZE as f32 + anchor.1,
                projection,
            );
            values[4 + keypoint * 2] = point.0;
            values[5 + keypoint * 2] = point.1;
        }
        if values[2] > values[0] && values[3] > values[1] {
            detections.push(Detection { score, values });
        }
    }
    Ok(detections)
}

fn detector_anchors() -> Vec<(f32, f32)> {
    let mut anchors = Vec::with_capacity(896);
    for (stride, repeats) in [(8_usize, 2_usize), (16, 6)] {
        let feature_map = DETECTOR_SIZE / stride;
        for y in 0..feature_map {
            for x in 0..feature_map {
                for _ in 0..repeats {
                    anchors.push((
                        (x as f32 + 0.5) / feature_map as f32,
                        (y as f32 + 0.5) / feature_map as f32,
                    ));
                }
            }
        }
    }
    debug_assert_eq!(anchors.len(), 896);
    anchors
}

fn weighted_nms(mut detections: Vec<Detection>) -> Vec<Detection> {
    detections.sort_by(|left, right| right.score.total_cmp(&left.score));
    let mut outputs = Vec::new();
    while let Some(reference) = detections.first().cloned() {
        let mut candidates = Vec::new();
        let mut remaining = Vec::new();
        for detection in detections.drain(..) {
            if intersection_over_union(&reference, &detection) > NMS_IOU_THRESHOLD {
                candidates.push(detection);
            } else {
                remaining.push(detection);
            }
        }
        let mut values = [0.0; 16];
        let total_score: f32 = candidates.iter().map(|detection| detection.score).sum();
        for detection in candidates {
            for (target, value) in values.iter_mut().zip(detection.values) {
                *target += value * detection.score / total_score;
            }
        }
        outputs.push(Detection {
            score: reference.score,
            values,
        });
        detections = remaining;
    }
    outputs
}

fn intersection_over_union(left: &Detection, right: &Detection) -> f32 {
    let xmin = left.values[0].max(right.values[0]);
    let ymin = left.values[1].max(right.values[1]);
    let xmax = left.values[2].min(right.values[2]);
    let ymax = left.values[3].min(right.values[3]);
    let intersection = (xmax - xmin).max(0.0) * (ymax - ymin).max(0.0);
    let left_area = (left.values[2] - left.values[0]) * (left.values[3] - left.values[1]);
    let right_area = (right.values[2] - right.values[0]) * (right.values[3] - right.values[1]);
    let union = left_area + right_area - intersection;
    if union > 0.0 {
        intersection / union
    } else {
        0.0
    }
}

fn roi_from_detection(detection: &Detection, image_width: usize, image_height: usize) -> Roi {
    let width = detection.values[2] - detection.values[0];
    let height = detection.values[3] - detection.values[1];
    let long_pixels = (width * image_width as f32).max(height * image_height as f32);
    let left_eye = (detection.values[4], detection.values[5]);
    let right_eye = (detection.values[6], detection.values[7]);
    let eye_dx = (right_eye.0 - left_eye.0) * image_width as f32;
    let eye_dy = (right_eye.1 - left_eye.1) * image_height as f32;
    Roi {
        x_center: (detection.values[0] + detection.values[2]) / 2.0,
        y_center: (detection.values[1] + detection.values[3]) / 2.0,
        width: long_pixels * ROI_SCALE / image_width as f32,
        height: long_pixels * ROI_SCALE / image_height as f32,
        rotation: eye_dy.atan2(eye_dx),
    }
}

fn refine_and_project_landmarks(outputs: &[Vec<f32>], roi: Roi) -> Result<Vec<Landmark>, String> {
    let expected = [1404, 160, 142, 142, 10, 10, 1];
    if outputs.len() != expected.len()
        || outputs
            .iter()
            .zip(expected)
            .any(|(values, len)| values.len() != len)
    {
        return Err("legacy attention model returned unexpected tensor shapes".into());
    }

    let mut landmarks: Vec<Landmark> = outputs[0]
        .chunks_exact(3)
        .map(|point| Landmark {
            x: point[0] / LANDMARK_SIZE as f32,
            y: point[1] / LANDMARK_SIZE as f32,
            z: point[2] / LANDMARK_SIZE as f32,
        })
        .collect();
    landmarks.extend((0..10).map(|_| Landmark {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    }));

    apply_xy_refinement(&mut landmarks, &outputs[1], &LIPS_MAPPING);
    apply_xy_refinement(&mut landmarks, &outputs[2], &LEFT_EYE_MAPPING);
    apply_xy_refinement(&mut landmarks, &outputs[3], &RIGHT_EYE_MAPPING);
    apply_xy_refinement(&mut landmarks, &outputs[4], &[468, 469, 470, 471, 472]);
    apply_xy_refinement(&mut landmarks, &outputs[5], &[473, 474, 475, 476, 477]);

    let left_iris_z = mean_z(&landmarks, &LEFT_IRIS_Z_AVERAGE);
    let right_iris_z = mean_z(&landmarks, &RIGHT_IRIS_Z_AVERAGE);
    for landmark in &mut landmarks[468..473] {
        landmark.z = left_iris_z;
    }
    for landmark in &mut landmarks[473..478] {
        landmark.z = right_iris_z;
    }

    Ok(landmarks
        .into_iter()
        .map(|landmark| project_landmark(landmark, roi))
        .collect())
}

fn apply_xy_refinement(landmarks: &mut [Landmark], values: &[f32], mapping: &[usize]) {
    for (point, target) in values.chunks_exact(2).zip(mapping) {
        landmarks[*target].x = point[0] / LANDMARK_SIZE as f32;
        landmarks[*target].y = point[1] / LANDMARK_SIZE as f32;
    }
}

fn mean_z(landmarks: &[Landmark], indexes: &[usize]) -> f32 {
    indexes.iter().map(|index| landmarks[*index].z).sum::<f32>() / indexes.len() as f32
}

fn project_point(x: f32, y: f32, roi: Roi) -> (f32, f32) {
    let relative_x = x - 0.5;
    let relative_y = y - 0.5;
    let sin = roi.rotation.sin();
    let cos = roi.rotation.cos();
    (
        roi.x_center + relative_x * roi.width * cos - relative_y * roi.height * sin,
        roi.y_center + relative_x * roi.width * sin + relative_y * roi.height * cos,
    )
}

fn project_landmark(landmark: Landmark, roi: Roi) -> Landmark {
    let (x, y) = project_point(landmark.x, landmark.y, roi);
    Landmark {
        x,
        y,
        z: landmark.z * roi.width,
    }
}

fn roi_from_landmarks(
    landmarks: &[Landmark],
    image_width: usize,
    image_height: usize,
) -> Option<Roi> {
    let first = landmarks.first()?;
    let (mut xmin, mut xmax, mut ymin, mut ymax) = (first.x, first.x, first.y, first.y);
    for landmark in &landmarks[1..] {
        xmin = xmin.min(landmark.x);
        xmax = xmax.max(landmark.x);
        ymin = ymin.min(landmark.y);
        ymax = ymax.max(landmark.y);
    }
    let long_pixels = ((xmax - xmin) * image_width as f32).max((ymax - ymin) * image_height as f32);
    if !long_pixels.is_finite() || long_pixels <= 0.0 {
        return None;
    }
    let left = landmarks[33];
    let right = landmarks[263];
    let eye_dx = (right.x - left.x) * image_width as f32;
    let eye_dy = (right.y - left.y) * image_height as f32;
    Some(Roi {
        x_center: (xmin + xmax) / 2.0,
        y_center: (ymin + ymax) / 2.0,
        width: long_pixels * ROI_SCALE / image_width as f32,
        height: long_pixels * ROI_SCALE / image_height as f32,
        rotation: eye_dy.atan2(eye_dx),
    })
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

pub(super) fn analyze_landmarks(landmarks: &[Landmark]) -> Option<FrameSignals> {
    if landmarks.len() < 478 {
        return None;
    }
    let right_ear = eye_aspect_ratio(landmarks, [33, 160, 158, 133, 153, 144]);
    let left_ear = eye_aspect_ratio(landmarks, [263, 387, 385, 362, 380, 373]);
    let nose = landmarks[1];
    let forehead = landmarks[10];
    let chin = landmarks[152];
    let face_height = chin.y - forehead.y;
    let lower_ratio = if face_height > 0.01 {
        (chin.y - nose.y) / face_height
    } else {
        0.5
    };
    let pitch_deg = ((0.5 - lower_ratio) * 2.0)
        .clamp(0.0, 1.0)
        .asin()
        .to_degrees();
    let pitch_up_deg = ((lower_ratio - 0.5) * 2.0)
        .clamp(0.0, 1.0)
        .asin()
        .to_degrees();
    let eye_left = landmarks[33];
    let eye_right = landmarks[263];
    let eye_width = (eye_right.x - eye_left.x).abs();
    let nose_delta = nose.x - (eye_left.x + eye_right.x) / 2.0;
    let yaw_magnitude = if eye_width > 0.01 {
        (nose_delta.abs() / eye_width * 2.0)
            .min(1.0)
            .asin()
            .to_degrees()
    } else {
        0.0
    };
    let yaw_signed = yaw_magnitude * if nose_delta >= 0.0 { 1.0 } else { -1.0 };
    let iris_h = horizontal_iris_gaze(landmarks);

    Some(FrameSignals {
        right_ear,
        left_ear,
        average_ear: (right_ear + left_ear) / 2.0,
        yaw_signed,
        pitch_deg,
        pitch_up_deg,
        iris_h,
    })
}

fn eye_aspect_ratio(landmarks: &[Landmark], indexes: [usize; 6]) -> f32 {
    let vertical = distance(landmarks[indexes[1]], landmarks[indexes[5]])
        + distance(landmarks[indexes[2]], landmarks[indexes[4]]);
    let horizontal = 2.0 * distance(landmarks[indexes[0]], landmarks[indexes[3]]);
    if horizontal > f32::EPSILON {
        vertical / horizontal
    } else {
        0.0
    }
}

fn horizontal_iris_gaze(landmarks: &[Landmark]) -> f32 {
    let right_out = landmarks[33];
    let right_in = landmarks[133];
    let right_iris = landmarks[468];
    let left_out = landmarks[263];
    let left_in = landmarks[362];
    let left_iris = landmarks[473];
    let right_width = (right_in.x - right_out.x).abs();
    let left_width = (left_in.x - left_out.x).abs();
    let right_offset = if right_width > 0.001 {
        (right_iris.x - (right_out.x + right_in.x) / 2.0) / right_width
    } else {
        0.0
    };
    let left_offset = if left_width > 0.001 {
        (left_iris.x - (left_out.x + left_in.x) / 2.0) / left_width
    } else {
        0.0
    };
    (right_offset + left_offset) / 2.0
}

fn distance(left: Landmark, right: Landmark) -> f32 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detector_anchor_layout_matches_the_legacy_graph() {
        let anchors = detector_anchors();
        assert_eq!(anchors.len(), 896);
        assert_eq!(anchors[0], (0.03125, 0.03125));
        assert_eq!(anchors[511], (0.96875, 0.96875));
        assert_eq!(anchors[512], (0.0625, 0.0625));
    }

    #[test]
    fn square_detector_tensor_letterboxes_without_reinterpreting_pixels() {
        let frame = RgbFrame {
            width: 2,
            height: 1,
            pixels: vec![255, 0, 0, 0, 0, 255],
        };
        let tensor = image_to_tensor(&frame, square_long_roi(2, 1), 2, 0.0, 1.0);
        assert_eq!(tensor.len(), 12);
        // Both rows straddle the image boundary equally. Red remains on the
        // left and blue on the right; no mirror is introduced by preprocessing.
        assert!(tensor[0] > tensor[2]);
        assert!(tensor[5] > tensor[3]);
        assert_eq!(tensor[0], tensor[6]);
        assert_eq!(tensor[5], tensor[11]);
    }

    #[test]
    fn projection_uses_clockwise_rotation_in_y_down_coordinates() {
        let roi = Roi {
            x_center: 0.5,
            y_center: 0.5,
            width: 0.4,
            height: 0.2,
            rotation: std::f32::consts::FRAC_PI_2,
        };
        let right_edge = project_point(1.0, 0.5, roi);
        assert!((right_edge.0 - 0.5).abs() < 1e-6);
        assert!((right_edge.1 - 0.7).abs() < 1e-6);
    }

    #[test]
    fn iris_depth_is_inherited_from_the_matching_eye() {
        let mut outputs = vec![
            vec![0.0; 1404],
            vec![0.0; 160],
            vec![0.0; 142],
            vec![0.0; 142],
            vec![0.0; 10],
            vec![0.0; 10],
            vec![1.0],
        ];
        for index in LEFT_IRIS_Z_AVERAGE {
            outputs[0][index * 3 + 2] = 192.0;
        }
        for index in RIGHT_IRIS_Z_AVERAGE {
            outputs[0][index * 3 + 2] = 384.0;
        }
        let landmarks = refine_and_project_landmarks(
            &outputs,
            Roi {
                x_center: 0.5,
                y_center: 0.5,
                width: 1.0,
                height: 1.0,
                rotation: 0.0,
            },
        )
        .expect("refined landmarks");
        assert_eq!(landmarks[468].z, 1.0);
        assert_eq!(landmarks[473].z, 2.0);
    }

    #[test]
    fn signal_signs_match_the_existing_javascript_ruler() {
        let mut landmarks = vec![
            Landmark {
                x: 0.5,
                y: 0.5,
                z: 0.0
            };
            478
        ];
        landmarks[10].y = 0.2;
        landmarks[152].y = 0.8;
        landmarks[1] = Landmark {
            x: 0.56,
            y: 0.45,
            z: 0.0,
        };
        landmarks[33].x = 0.3;
        landmarks[263].x = 0.7;
        for (index, point) in [
            (160, (0.35, 0.45)),
            (158, (0.4, 0.45)),
            (133, (0.45, 0.5)),
            (153, (0.4, 0.55)),
            (144, (0.35, 0.55)),
            (387, (0.65, 0.45)),
            (385, (0.6, 0.45)),
            (362, (0.55, 0.5)),
            (380, (0.6, 0.55)),
            (373, (0.65, 0.55)),
        ] {
            landmarks[index].x = point.0;
            landmarks[index].y = point.1;
        }
        landmarks[468].x = 0.41;
        landmarks[473].x = 0.61;

        let signals = analyze_landmarks(&landmarks).expect("478 landmarks");
        assert!(signals.yaw_signed > 0.0, "positive yaw means head left");
        assert!(signals.iris_h > 0.0, "positive iris means eyes right");
    }
}
