import { describe, expect, it } from 'vitest'
import { CALIBRATION_SECS } from './attention'
import {
  PARITY_FRAME_INTERVAL_MS,
  createCameraScoreReplay,
  replayCameraScores,
} from './cameraScoreReplay'

function makeLandmarks({ noseX = 0.5, irisShift = 0, mouthOpen = 0.02 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const set = (index, x, y) => { landmarks[index] = { x, y, z: 0 } }

  set(1, noseX, 0.50)
  set(10, 0.5, 0.20)
  set(152, 0.5, 0.80)
  set(33, 0.35, 0.45); set(133, 0.45, 0.45)
  set(263, 0.65, 0.45); set(362, 0.55, 0.45)
  set(160, 0.40, 0.43); set(144, 0.40, 0.47)
  set(158, 0.42, 0.43); set(153, 0.42, 0.47)
  set(387, 0.60, 0.43); set(373, 0.60, 0.47)
  set(385, 0.58, 0.43); set(380, 0.58, 0.47)
  set(468, 0.40 + irisShift * 0.10, 0.45)
  set(473, 0.60 + irisShift * 0.10, 0.45)
  set(61, 0.45, 0.68); set(291, 0.55, 0.68)
  set(13, 0.50, 0.68 - mouthOpen); set(14, 0.50, 0.68 + mouthOpen)
  set(312, 0.51, 0.68 - mouthOpen); set(317, 0.51, 0.68 + mouthOpen)
  return landmarks
}

const measuredFrame = landmarks => ({ frameMeasured: true, landmarks })

describe('camera parity score replay', () => {
  it('holds the live calibration score for the full calibration interval', () => {
    const frameCount = Math.ceil(CALIBRATION_SECS * 1000 / PARITY_FRAME_INTERVAL_MS)
    const scores = replayCameraScores(
      Array.from({ length: frameCount }, () => measuredFrame(makeLandmarks())),
    )

    expect(scores).toHaveLength(frameCount)
    expect(new Set(scores)).toEqual(new Set([68]))
  })

  it('is deterministic when both engines provide identical landmarks', () => {
    const records = Array.from({ length: 500 }, (_, index) => measuredFrame(makeLandmarks({
      noseX: index > 350 ? 0.56 : 0.5,
      irisShift: index > 400 ? 1 : 0,
    })))

    expect(replayCameraScores(records)).toEqual(replayCameraScores(records))
  })

  it('returns no score for a frame explicitly marked as unmeasured', () => {
    const replay = createCameraScoreReplay()
    const landmarks = makeLandmarks()

    expect(replay.step(measuredFrame(landmarks), 0)).toBe(68)
    expect(replay.step({ frameMeasured: false, landmarks }, 1)).toBeNull()
    expect(replay.step(measuredFrame(landmarks), 2)).toBe(68)
  })

  it('treats an analysed no-face result as data instead of inventing landmarks', () => {
    const frameCount = Math.ceil(CALIBRATION_SECS * 1000 / PARITY_FRAME_INTERVAL_MS) + 2
    const replay = createCameraScoreReplay()
    const landmarks = makeLandmarks()
    let score = null

    for (let index = 0; index < frameCount - 1; index += 1) {
      score = replay.step(measuredFrame(landmarks), index)
    }
    const noFaceScore = replay.step(measuredFrame(null), frameCount - 1)

    expect(score).toBeGreaterThan(68)
    expect(noFaceScore).toBeLessThan(score)
    expect(noFaceScore).not.toBeNull()
  })
})
