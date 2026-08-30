import { analyzeFrame, eyeAspectRatio, LEFT_EYE, RIGHT_EYE } from './lib/attention'

const framesInput = document.querySelector('#frames')
const backendInput = document.querySelector('#backend')
const runButton = document.querySelector('#run')
const status = document.querySelector('#status')

let selectedFrames = []

framesInput.addEventListener('change', () => {
  selectedFrames = [...framesInput.files]
    .filter(file => /\.(png|jpe?g)$/i.test(file.name))
    .sort((left, right) => left.webkitRelativePath.localeCompare(right.webkitRelativePath))
  runButton.disabled = selectedFrames.length === 0
  status.textContent = selectedFrames.length ? `${selectedFrames.length} frames ready` : 'No image frames selected'
})

runButton.addEventListener('click', async () => {
  runButton.disabled = true
  framesInput.disabled = true
  backendInput.disabled = true
  try {
    const backend = backendInput.value
    const records = await runReference(selectedFrames, backend, (done, total) => {
      status.textContent = `Processing ${done}/${total}`
    })
    downloadJsonLines(records, `facemesh-js-${backend}-reference.jsonl`)
    const faces = records.filter(record => record.facePresent).length
    status.textContent = `Done: ${records.length} frames, ${faces} with a face`
  } catch (error) {
    status.textContent = `Failed: ${error?.message || error}`
  } finally {
    framesInput.disabled = false
    backendInput.disabled = false
    runButton.disabled = selectedFrames.length === 0
  }
})

async function runReference(files, backend, onProgress) {
  if (!window.FaceMesh) throw new Error('Bundled FaceMesh.js did not load')
  const faceMesh = new window.FaceMesh({
    locateFile: file => new URL(`mediapipe/${file}`, document.baseURI).href,
  })
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    // GPU is the historical macOS session ruler. CPU exists only to isolate
    // backend drift from preprocessing drift; it may never authorize a source
    // switch against GPU-recorded history.
    useCpuInference: backend === 'cpu',
  })

  let resolveResults = null
  faceMesh.onResults(results => {
    resolveResults?.(results)
    resolveResults = null
  })

  const records = []
  for (const [frameIndex, file] of files.entries()) {
    const image = await loadImage(file)
    const resultsPromise = new Promise(resolve => { resolveResults = resolve })
    await faceMesh.send({ image })
    const results = await resultsPromise
    URL.revokeObjectURL(image.src)
    const landmarks = results.multiFaceLandmarks?.[0]?.map(({ x, y, z }) => ({ x, y, z })) || null
    records.push({
      frameIndex,
      fileName: file.name,
      inferenceBackend: backend,
      frameMeasured: true,
      facePresent: Boolean(landmarks),
      landmarks,
      signals: landmarks ? normalizeSignals(landmarks, analyzeFrame(landmarks)) : null,
      attentionScore: null,
    })
    onProgress(frameIndex + 1, files.length)
  }
  faceMesh.close?.()
  return records
}

function normalizeSignals(landmarks, signals) {
  return {
    rightEar: eyeAspectRatio(landmarks, RIGHT_EYE),
    leftEar: eyeAspectRatio(landmarks, LEFT_EYE),
    averageEar: signals.avgEar,
    yawSigned: signals.yawSigned,
    pitchDeg: signals.pitchDeg,
    pitchUpDeg: signals.pitchUpDeg,
    irisH: signals.irisH,
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not decode ${file.name}`))
    image.src = URL.createObjectURL(file)
  })
}

function downloadJsonLines(records, fileName) {
  const body = `${records.map(record => JSON.stringify(record)).join('\n')}\n`
  const url = URL.createObjectURL(new Blob([body], { type: 'application/x-ndjson' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
