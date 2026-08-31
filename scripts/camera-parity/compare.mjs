import { readFileSync } from 'node:fs'
import { FOCUSED_SCORE } from '../../src/lib/attention.js'
import { replayCameraScores } from '../../src/lib/cameraScoreReplay.js'

const LIMITS = Object.freeze({
  landmarkP95: 0.005,
  landmarkMax: 0.02,
  poseP95Degrees: 1.5,
  scoreP95: 2,
  focusedClassificationParity: 0.99,
})

const [jsPath, nativePath] = process.argv.slice(2)
if (!jsPath || !nativePath) {
  console.error('usage: npm run camera:parity:compare -- <facemesh-js.jsonl> <native.jsonl>')
  process.exit(2)
}

const jsFrames = readJsonLines(jsPath)
const nativeFrames = readJsonLines(nativePath)
if (jsFrames.length !== nativeFrames.length) {
  throw new Error(`frame count differs: JS ${jsFrames.length}, native ${nativeFrames.length}`)
}
const jsReplayScores = replayCameraScores(jsFrames)
const nativeReplayScores = replayCameraScores(nativeFrames)

const landmarkErrors = []
const signalErrors = new Map([
  ['yawSigned', []],
  ['pitchDeg', []],
  ['rightEar', []],
  ['leftEar', []],
  ['averageEar', []],
  ['irisH', []],
])
const scoreErrors = []
const scoreDiagnostics = []
const focusedClassificationMismatches = []
const frameDiagnostics = []
const facePresenceMismatches = []
let scoreClassifications = 0
let equalScoreClassifications = 0
let faceParity = 0

for (let index = 0; index < jsFrames.length; index += 1) {
  const js = jsFrames[index]
  const native = nativeFrames[index]
  if (js.fileName !== native.fileName) {
    throw new Error(`frame ${index} names differ: ${js.fileName} vs ${native.fileName}`)
  }
  if (js.facePresent === native.facePresent) faceParity += 1
  else {
    facePresenceMismatches.push({
      frameIndex: index,
      fileName: js.fileName,
      jsFacePresent: js.facePresent,
      nativeFacePresent: native.facePresent,
    })
  }
  if (js.landmarks && native.landmarks) {
    if (js.landmarks.length !== native.landmarks.length) {
      throw new Error(`frame ${index} landmark count differs`)
    }
    const frameLandmarkErrors = []
    for (let point = 0; point < js.landmarks.length; point += 1) {
      const left = js.landmarks[point]
      const right = native.landmarks[point]
      const error = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
      landmarkErrors.push(error)
      frameLandmarkErrors.push(error)
    }
    const frameSignalErrors = {}
    for (const [name, errors] of signalErrors) {
      const left = js.signals?.[name]
      const right = native.signals?.[name]
      if (Number.isFinite(left) && Number.isFinite(right)) {
        const error = Math.abs(left - right)
        errors.push(error)
        frameSignalErrors[name] = error
        frameSignalErrors[`js${capitalize(name)}`] = left
        frameSignalErrors[`native${capitalize(name)}`] = right
      }
    }
    frameDiagnostics.push({
      frameIndex: index,
      fileName: js.fileName,
      landmarkMean: mean(frameLandmarkErrors),
      landmarkP95: percentile([...frameLandmarkErrors].sort((left, right) => left - right), 0.95),
      landmarkMax: Math.max(...frameLandmarkErrors),
      ...frameSignalErrors,
    })
  }
  const jsScore = Number.isFinite(js.attentionScore) ? js.attentionScore : jsReplayScores[index]
  const nativeScore = Number.isFinite(native.attentionScore)
    ? native.attentionScore
    : nativeReplayScores[index]
  if (Number.isFinite(jsScore) && Number.isFinite(nativeScore)) {
    const scoreError = Math.abs(jsScore - nativeScore)
    scoreErrors.push(scoreError)
    scoreDiagnostics.push({
      frameIndex: index,
      fileName: js.fileName,
      score: scoreError,
      jsScore,
      nativeScore,
    })
    scoreClassifications += 1
    if ((jsScore >= FOCUSED_SCORE) === (nativeScore >= FOCUSED_SCORE)) {
      equalScoreClassifications += 1
    } else {
      focusedClassificationMismatches.push({
        frameIndex: index,
        fileName: js.fileName,
        jsScore,
        nativeScore,
      })
    }
  }
}

const report = {
  gatePassed: false,
  limits: LIMITS,
  frames: jsFrames.length,
  facePresenceParity: ratio(faceParity, jsFrames.length),
  facePresenceMismatches,
  landmarks: statistics(landmarkErrors),
  signals: Object.fromEntries([...signalErrors].map(([name, errors]) => [name, statistics(errors)])),
  scoreSource: 'shared_js_camera_replay_v1',
  scores: scoreErrors.length ? statistics(scoreErrors) : null,
  focusedClassificationParity: scoreClassifications
    ? ratio(equalScoreClassifications, scoreClassifications)
    : null,
  focusedClassificationMismatches: {
    count: focusedClassificationMismatches.length,
    frames: focusedClassificationMismatches.slice(0, 30),
  },
  worstFrames: {
    landmarkMax: topFrames(frameDiagnostics, 'landmarkMax'),
    yawSigned: topFrames(frameDiagnostics, 'yawSigned'),
    pitchDeg: topFrames(frameDiagnostics, 'pitchDeg'),
    score: topScoreFrames(scoreDiagnostics),
  },
  blockers: [],
}

if (!landmarkErrors.length) report.blockers.push('No frames contained landmarks in both engines.')
if (!scoreErrors.length) report.blockers.push('Attention scores are absent; scoring parity cannot be evaluated.')
if (report.facePresenceParity < 0.99) report.blockers.push('Face-presence parity is below 99%.')
if (report.landmarks && (report.landmarks.p95 >= LIMITS.landmarkP95 || report.landmarks.max >= LIMITS.landmarkMax)) {
  report.blockers.push('Landmark error exceeds the fixed gate.')
}
for (const name of ['yawSigned', 'pitchDeg']) {
  if (report.signals[name]?.p95 >= LIMITS.poseP95Degrees) {
    report.blockers.push(`${name} p95 exceeds the fixed pose gate.`)
  }
}
if (report.scores?.p95 >= LIMITS.scoreP95) report.blockers.push('Score p95 exceeds the fixed gate.')
if (report.focusedClassificationParity !== null && report.focusedClassificationParity < LIMITS.focusedClassificationParity) {
  report.blockers.push('FOCUSED_SCORE classification parity is below 99%.')
}
report.gatePassed = report.blockers.length === 0

console.log(JSON.stringify(report, null, 2))
if (!report.gatePassed) process.exitCode = 2

function readJsonLines(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function statistics(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  }
}

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
}

function topFrames(frames, metric, count = 10) {
  return [...frames]
    .filter(frame => Number.isFinite(frame[metric]))
    .sort((left, right) => right[metric] - left[metric])
    .slice(0, count)
    .map(frame => ({
      frameIndex: frame.frameIndex,
      fileName: frame.fileName,
      [metric]: frame[metric],
      [`js${capitalize(metric)}`]: frame[`js${capitalize(metric)}`],
      [`native${capitalize(metric)}`]: frame[`native${capitalize(metric)}`],
      landmarkMean: frame.landmarkMean,
      landmarkP95: frame.landmarkP95,
    }))
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1)
}

function topScoreFrames(frames, count = 10) {
  return [...frames]
    .sort((left, right) => right.score - left.score)
    .slice(0, count)
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null
}
