import { readFileSync } from 'node:fs'

const FOCUSED_SCORE = 40
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
  if (js.landmarks && native.landmarks) {
    if (js.landmarks.length !== native.landmarks.length) {
      throw new Error(`frame ${index} landmark count differs`)
    }
    for (let point = 0; point < js.landmarks.length; point += 1) {
      const left = js.landmarks[point]
      const right = native.landmarks[point]
      landmarkErrors.push(Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z))
    }
    for (const [name, errors] of signalErrors) {
      const left = js.signals?.[name]
      const right = native.signals?.[name]
      if (Number.isFinite(left) && Number.isFinite(right)) errors.push(Math.abs(left - right))
    }
  }
  const jsScore = js.attentionScore
  const nativeScore = native.attentionScore
  if (Number.isFinite(jsScore) && Number.isFinite(nativeScore)) {
    scoreErrors.push(Math.abs(jsScore - nativeScore))
    scoreClassifications += 1
    if ((jsScore >= FOCUSED_SCORE) === (nativeScore >= FOCUSED_SCORE)) equalScoreClassifications += 1
  }
}

const report = {
  gatePassed: false,
  limits: LIMITS,
  frames: jsFrames.length,
  facePresenceParity: ratio(faceParity, jsFrames.length),
  landmarks: statistics(landmarkErrors),
  signals: Object.fromEntries([...signalErrors].map(([name, errors]) => [name, statistics(errors)])),
  scores: scoreErrors.length ? statistics(scoreErrors) : null,
  focusedClassificationParity: scoreClassifications
    ? ratio(equalScoreClassifications, scoreClassifications)
    : null,
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

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null
}
