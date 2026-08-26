import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeFrame } from '../lib/attention'
import { normalizeCalibration } from '../lib/workspaceStore'
import { WORKSPACE_OBJECT_LABELS } from '../lib/workspaceObjects'

const MIN_SAMPLES = 30
const CAPTURE_TIMEOUT_MS = 8_000

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function summarize(samples, baseline) {
  const yaw = median(samples.map(sample => sample.yawSigned))
  const pitch = median(samples.map(sample => sample.pitchSigned ?? sample.pitchDeg))
  const iris = median(samples.map(sample => sample.irisH))
  const yawMad = median(samples.map(sample => Math.abs(sample.yawSigned - yaw)))
  const pitchMad = median(samples.map(sample => Math.abs((sample.pitchSigned ?? sample.pitchDeg) - pitch)))
  const irisMad = median(samples.map(sample => Math.abs(sample.irisH - iris)))
  const quality = Math.max(0, Math.min(1, 1 - yawMad / 6 - pitchMad / 6 - irisMad / 0.08))
  return {
    deltaYaw: yaw - (baseline?.yaw ?? yaw),
    deltaPitch: pitch - (baseline?.pitch ?? pitch),
    deltaIrisH: iris - (baseline?.iris ?? iris),
    quality,
    sampleCount: samples.length,
    absolute: { yaw, pitch, iris },
  }
}

export default function WorkspaceCalibration({ workspace, onDone, onCancel }) {
  const primary = workspace.objects.find(object => object.role === 'primary_screen') || workspace.objects[0]
  const targets = useMemo(() => [primary, ...workspace.objects.filter(object => object.id !== primary.id)], [workspace, primary])
  const [index, setIndex] = useState(0)
  const [samples, setSamples] = useState([])
  const [captured, setCaptured] = useState({ ...(workspace.calibration?.targets || {}) })
  const [baseline, setBaseline] = useState(null)
  const [status, setStatus] = useState('starting')
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const faceMeshRef = useRef(null)
  const startedAtRef = useRef(Date.now())
  const samplesRef = useRef([])
  const target = targets[index]

  useEffect(() => { samplesRef.current = samples }, [samples])

  useEffect(() => {
    let stopped = false
    let stream = null
    let timer = null
    let inFlight = false

    async function start() {
      if (!window.FaceMesh) throw new Error('The local tracking engine is unavailable.')
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } })
      if (stopped) return stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => {})
      const faceMesh = new window.FaceMesh({ locateFile: file => new URL(`mediapipe/${file}`, document.baseURI).href })
      faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })
      faceMesh.onResults(results => {
        if (stopped || status === 'done') return
        const landmarks = results.multiFaceLandmarks?.[0]
        if (!landmarks) return
        const analyzed = analyzeFrame(landmarks)
        const frame = { ...analyzed, pitchSigned: analyzed.pitchDeg - analyzed.pitchUpDeg }
        setSamples(previous => previous.length >= MIN_SAMPLES ? previous : [...previous, frame])
      })
      faceMeshRef.current = faceMesh
      setStatus('capturing')
      const pump = async () => {
        if (stopped) return
        timer = window.setTimeout(pump, 67)
        if (inFlight || videoRef.current?.readyState < 2) return
        inFlight = true
        await faceMesh.send({ image: videoRef.current }).catch(() => {})
        inFlight = false
      }
      pump()
    }

    start().catch(err => setError(err?.message || 'Camera calibration could not start.'))
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach(track => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      faceMeshRef.current?.close?.()
    }
  }, [])

  useEffect(() => {
    if (status !== 'capturing' || !target) return
    if (samples.length >= MIN_SAMPLES) {
      const result = summarize(samples, baseline)
      if (result.quality < 0.35) {
        setStatus('unstable')
        return
      }
      const nextBaseline = baseline || result.absolute
      if (!baseline) setBaseline(nextBaseline)
      setCaptured(previous => ({ ...previous, [target.id]: {
        deltaYaw: result.deltaYaw,
        deltaPitch: result.deltaPitch,
        deltaIrisH: result.deltaIrisH,
        quality: result.quality,
        sampleCount: result.sampleCount,
      } }))
      setStatus('captured')
      return
    }
    const remaining = CAPTURE_TIMEOUT_MS - (Date.now() - startedAtRef.current)
    const timeout = setTimeout(() => setStatus('timeout'), Math.max(0, remaining))
    return () => clearTimeout(timeout)
  }, [samples, status, target, baseline])

  const advance = (skip = false) => {
    if (index >= targets.length - 1) {
      const calibration = normalizeCalibration({
        version: 1,
        capturedAt: Date.now(),
        primaryObjectId: primary.id,
        cameraObjectId: workspace.objects.find(object => object.type === 'camera')?.id || null,
        targets: captured,
      }, workspace.objects)
      onDone(calibration)
      return
    }
    if (!skip && status !== 'captured') return
    setIndex(value => value + 1)
    setSamples([])
    samplesRef.current = []
    startedAtRef.current = Date.now()
    setStatus('capturing')
  }

  const retry = () => {
    setSamples([])
    samplesRef.current = []
    startedAtRef.current = Date.now()
    setStatus('capturing')
  }

  return (
    <div className="workspace-calibration">
      <div className="workspace-calibration-copy">
        <span>Calibration · {index + 1} / {targets.length}</span>
        <h2>Look at your {WORKSPACE_OBJECT_LABELS[target?.type] || 'object'}</h2>
        <p>Keep your head and eyes naturally on the object. Frames stay on this device and are never recorded.</p>
        <div className="workspace-calibration-progress"><i style={{ width: `${Math.min(100, samples.length / MIN_SAMPLES * 100)}%` }} /></div>
        {status === 'captured' && <strong className="workspace-good">Target captured</strong>}
        {(status === 'unstable' || status === 'timeout') && <strong className="workspace-warn">Signal was not stable enough. Nothing was guessed.</strong>}
        {error && <strong className="workspace-warn">{error}</strong>}
        <div className="workspace-actions">
          <button type="button" className="secondary" onClick={onCancel}>Exit calibration</button>
          {index > 0 && status !== 'captured' && <button type="button" className="secondary" onClick={() => advance(true)}>Skip target</button>}
          {(status === 'unstable' || status === 'timeout') && <button type="button" onClick={retry}>Retry</button>}
          {status === 'captured' && <button type="button" onClick={() => advance(false)}>{index === targets.length - 1 ? 'Finish' : 'Next target'}</button>}
        </div>
      </div>
      <div className="workspace-camera-frame">
        <video ref={videoRef} muted playsInline />
        <div className="workspace-camera-reticle"><span /></div>
      </div>
    </div>
  )
}
