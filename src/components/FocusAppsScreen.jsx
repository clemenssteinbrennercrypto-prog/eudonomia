import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchNativeCameraStatus,
  installCompanionHelper,
  listenNativeCameraLandmarks,
  listenNativeCameraStatus,
  pushCompanionSession,
  startNativeCameraPrototype,
  stopNativeCameraPrototype,
} from '../lib/nativeCompanion'
import { getDomainsFromAppPreset } from '../lib/focusAppsConfig'
import {
  createProtectionSetup,
  firstProtectionSetupWithNameIssue,
  normalizeProtectionSetup,
  protectionDraftKey,
  protectionSetupNameIssue,
  removeProtectionSetup,
} from '../lib/protectionSetups'
import { getProtectionReadiness } from '../lib/protectionReadiness'
import { useCompanionStatus } from '../lib/useCompanionStatus'
import {
  loadFocusModeEnabled,
  loadProtectionSetups,
  saveFocusModeEnabled,
  saveProtectionSetups,
} from '../lib/storage'
import ConfirmDialog from './ConfirmDialog'
import { formatDuration } from '../lib/durationFormat'

const FOCUS_PRESETS = ['VS Code', 'Figma', 'Terminal', 'Notion', 'Safari', 'Chrome']
const DISTRACTION_PRESETS = ['YouTube', 'Instagram', 'Twitter/X', 'TikTok', 'Reddit', 'Netflix']
const SHOW_NATIVE_CAMERA_DIAGNOSTICS = import.meta.env.DEV ||
  import.meta.env.VITE_EUDONOMIA_BUILD_CHANNEL === 'test'

function addUnique(list, value) {
  const app = value.trim()
  if (!app) return list
  if (list.some(item => item.toLowerCase() === app.toLowerCase())) return list
  return [...list, app]
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0]
  }
}

function domainsFor(items) {
  return items.flatMap(item => {
    const key = String(item || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const presetDomains = getDomainsFromAppPreset(key)
    if (presetDomains.length) return presetDomains
    const normalized = normalizeDomain(item)
    return normalized.includes('.') ? [normalized] : []
  })
}

function ageLabel(ts, now = Date.now()) {
  if (!ts) return 'never'
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${formatDuration(Math.round(seconds / 60) * 60)} ago`
}

function AppChip({ app, tone, onRemove }) {
  const colors = tone === 'focus'
    ? { bg: 'rgba(47,227,168,0.07)', border: 'rgba(47,227,168,0.30)', text: 'var(--good)', xBg: 'rgba(47,227,168,0.10)', xText: 'var(--good)' }
    : { bg: 'rgba(255,77,106,0.07)', border: 'rgba(255,77,106,0.30)', text: 'var(--bad)', xBg: 'rgba(255,77,106,0.12)', xText: 'var(--bad)' }

  return (
    <span
      style={{
        minHeight: 34,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 100,
        padding: '6px 7px 6px 13px',
        color: colors.text,
        fontSize: 13,
        fontWeight: 700,
        maxWidth: '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${app}`}
        style={{
          width: 21,
          height: 21,
          borderRadius: '50%',
          border: 'none',
          background: colors.xBg,
          color: colors.xText,
          cursor: 'pointer',
          lineHeight: 1,
          fontSize: 15,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        x
      </button>
    </span>
  )
}

function AppSection({ title, subtitle, apps, setApps, presets, inputValue, setInputValue, tone }) {
  const availablePresets = useMemo(
    () => presets.filter(preset => !apps.some(app => app.toLowerCase() === preset.toLowerCase())),
    [apps, presets]
  )

  const addApp = (value = inputValue) => {
    setApps(prev => addUnique(prev, value))
    setInputValue('')
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--ultra-bright)', fontSize: 20, fontWeight: 800, letterSpacing: 0 }}>{title}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.45 }}>{subtitle}</p>
        </div>
        <span style={{
          border: '1px solid var(--line)',
          borderRadius: 100,
          padding: '4px 10px',
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 700,
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          {apps.length}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          className="text-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addApp()
            }
          }}
          placeholder="Type app or website"
          style={{ flex: 1, minWidth: 0, fontSize: 15, borderRadius: 13 }}
        />
        <button
          type="button"
          onClick={() => addApp()}
          style={{
            background: 'var(--ultra)',
            border: 'none',
            borderRadius: 13,
            padding: '0 16px',
            color: 'var(--text)',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          Add
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 34 }}>
        {apps.map(app => (
          <AppChip
            key={app}
            app={app}
            tone={tone}
            onRemove={() => setApps(prev => prev.filter(item => item !== app))}
          />
        ))}
        {apps.length === 0 && (
          <div style={{
            width: '100%',
            border: '1.5px dashed var(--line)',
            borderRadius: 14,
            padding: '14px 16px',
            color: 'var(--text-muted)',
            fontSize: 13,
            lineHeight: 1.45,
            background: 'rgba(122,152,255,0.06)',
          }}>
            Nothing here yet. Add a preset or type your own.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {availablePresets.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => addApp(preset)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 100,
              padding: '6px 12px',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            + {preset}
          </button>
        ))}
      </div>
    </section>
  )
}

function NativeCameraDiagnostics() {
  const [camera, setCamera] = useState({
    state: 'stopped',
    fault: null,
    frameSequence: 0,
    lastFrameAtMs: null,
  })
  const [facePresent, setFacePresent] = useState(null)
  const [landmarkCount, setLandmarkCount] = useState(0)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    const unlisteners = []

    const refresh = async () => {
      try {
        const status = await fetchNativeCameraStatus()
        if (!cancelled && status) setCamera(status)
      } catch (error) {
        if (!cancelled) setActionError(String(error?.message || error))
      }
    }
    const subscribe = async () => {
      const [unlistenLandmarks, unlistenStatus] = await Promise.all([
        listenNativeCameraLandmarks(payload => {
          if (cancelled || !payload) return
          setFacePresent(payload.facePresent === true)
          setLandmarkCount(Array.isArray(payload.landmarks) ? payload.landmarks.length : 0)
          setCamera(previous => ({
            ...previous,
            state: 'running',
            fault: null,
            frameSequence: payload.frameSequence,
            lastFrameAtMs: payload.capturedAtMs,
          }))
        }),
        listenNativeCameraStatus(payload => {
          if (cancelled || !payload) return
          setCamera(payload)
          if (payload.state !== 'running') {
            setFacePresent(null)
            setLandmarkCount(0)
          }
        }),
      ])
      if (cancelled) {
        unlistenLandmarks?.()
        unlistenStatus?.()
        return
      }
      unlisteners.push(unlistenLandmarks, unlistenStatus)
    }

    refresh()
    subscribe()
    const interval = setInterval(refresh, 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
      unlisteners.forEach(unlisten => unlisten?.())
      // This diagnostic must never remain a second camera owner after the user
      // leaves Protection and starts a real session.
      stopNativeCameraPrototype().catch(() => {})
    }
  }, [])

  const start = async () => {
    setActionError('')
    try {
      const status = await startNativeCameraPrototype()
      if (!status) throw new Error('Native Companion unavailable')
      setCamera(status)
    } catch (error) {
      setActionError(String(error?.message || error))
    }
  }

  const stop = async () => {
    setActionError('')
    try {
      const status = await stopNativeCameraPrototype()
      if (status) {
        setCamera(status)
        setFacePresent(null)
        setLandmarkCount(0)
      }
    } catch (error) {
      setActionError(String(error?.message || error))
    }
  }

  const active = camera.state === 'starting' || camera.state === 'running' ||
    (camera.state === 'faulted' && camera.fault === 'no_frames')
  const statusTone = camera.state === 'running'
    ? 'var(--good)'
    : camera.state === 'faulted'
      ? 'var(--bad)'
      : 'var(--warn)'

  return (
    <section style={{
      background: 'rgba(122,152,255,0.06)',
      border: '1px solid var(--line)',
      borderRadius: 16,
      padding: '14px 16px',
      display: 'grid',
      gap: 12,
    }}>
      <div>
        <div style={{ color: 'var(--ultra-bright)', fontSize: 13, fontWeight: 900 }}>
          Native camera diagnostics
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
          The native camera is the measurement source for every new session. Sessions from the
          earlier camera method remain readable, but scores, trends and patterns never mix methods.
          These controls inspect capture health only; they do not change the scoring source.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: statusTone, fontSize: 12, fontWeight: 900 }}>
          {camera.state || 'unknown'}{camera.fault ? ` · ${camera.fault}` : ''}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 750 }}>
          Frame {Number(camera.frameSequence || 0).toLocaleString()}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 750 }}>
          Face {facePresent === null ? '—' : facePresent ? `yes · ${landmarkCount} points` : 'no'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>
          Last native frame: {ageLabel(camera.lastFrameAtMs)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={start}
          disabled={active}
          style={{
            border: 'none', borderRadius: 10, padding: '8px 13px', fontFamily: 'inherit',
            background: active ? 'var(--line)' : 'var(--ultra)', color: 'var(--text)',
            cursor: active ? 'default' : 'pointer', fontSize: 12, fontWeight: 900,
          }}
        >
          Start native capture
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!active && camera.state !== 'faulted'}
          style={{
            border: '1px solid var(--line)', borderRadius: 10, padding: '8px 13px',
            fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text-secondary)',
            cursor: !active && camera.state !== 'faulted' ? 'default' : 'pointer',
            fontSize: 12, fontWeight: 850,
          }}
        >
          Stop
        </button>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.45 }}>
        The buttons below remain a capture diagnostic. Leaving this screen stops it before a
        session takes ownership of the camera.
      </div>
      {actionError && (
        <div style={{ color: 'var(--bad)', fontSize: 11, fontWeight: 800 }}>{actionError}</div>
      )}
    </section>
  )
}

export default function FocusAppsScreen({
  onBack,
  focusModeEnabled,
  setFocusModeEnabled,
  protectionState: suppliedProtectionState,
  onProtectionStateChange,
}) {
  const initialState = useMemo(() => suppliedProtectionState || loadProtectionSetups(), [suppliedProtectionState])
  const [protectionState, setProtectionState] = useState(initialState)
  const [savedProtectionState, setSavedProtectionState] = useState(initialState)
  // Which setup the editor shows is view state. It is deliberately separate
  // from activeSetupId (the setup sessions use), so browsing the library never
  // counts as an unsaved change or silently switches the session setup.
  const [editingSetupId, setEditingSetupId] = useState(initialState.activeSetupId)
  const [nameErrorVisible, setNameErrorVisible] = useState(false)
  const [focusInput, setFocusInput] = useState('')
  const [distractionInput, setDistractionInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmingBack, setConfirmingBack] = useState(false)
  const [setupPendingDeletion, setSetupPendingDeletion] = useState(null)
  const [localFocusModeEnabled, setLocalFocusModeEnabled] = useState(() => loadFocusModeEnabled())
  const [testFeedback, setTestFeedback] = useState('')
  const [testBlockingActive, setTestBlockingActive] = useState(false)
  const [helperInstallState, setHelperInstallState] = useState({ status: 'idle', error: '' })
  const testTimerRef = useRef(null)
  const testBlockingActiveRef = useRef(false)
  const savedTimerRef = useRef(null)

  const activeSetup = useMemo(
    () => protectionState.setups.find(setup => setup.id === editingSetupId)
      || protectionState.setups.find(setup => setup.id === protectionState.activeSetupId)
      || protectionState.setups[0],
    [protectionState, editingSetupId],
  )
  const activeSetupEditingId = activeSetup.id
  const isSessionSetup = activeSetup.id === protectionState.activeSetupId
  const focusApps = activeSetup.focusApps
  const distractionApps = activeSetup.distractionApps
  const strictMode = activeSetup.strictMode
  const configuredCount = focusApps.length + distractionApps.length
  const modeEnabled = focusModeEnabled ?? localFocusModeEnabled
  const companionStatus = useCompanionStatus({ enabled: modeEnabled, intervalMs: 5000 })
  const effectiveCompanionStatus = helperInstallState.status === 'installed'
    ? { ...companionStatus, helperInstalled: true }
    : companionStatus
  const readiness = useMemo(
    () => getProtectionReadiness({ enabled: modeEnabled, setup: normalizeProtectionSetup(activeSetup, activeSetup.id), nativeStatus: effectiveCompanionStatus }),
    [modeEnabled, activeSetup, effectiveCompanionStatus],
  )
  const rulesConfigured = strictMode || distractionApps.length > 0
  const protectionReady = readiness.state === 'ready'
  const nameIssue = protectionSetupNameIssue(protectionState.setups, activeSetup.id)
  const invalidNameSetup = firstProtectionSetupWithNameIssue(protectionState.setups)

  const updateActiveSetup = useCallback((patch) => {
    setProtectionState(current => ({
      ...current,
      setups: current.setups.map(setup => setup.id === activeSetupEditingId
        ? { ...setup, ...(typeof patch === 'function' ? patch(setup) : patch) }
        : setup),
    }))
  }, [activeSetupEditingId])

  const setFocusApps = useCallback((update) => {
    updateActiveSetup(setup => ({
      focusApps: typeof update === 'function' ? update(setup.focusApps) : update,
      focusDomains: [],
    }))
  }, [updateActiveSetup])

  const setDistractionApps = useCallback((update) => {
    updateActiveSetup(setup => ({
      distractionApps: typeof update === 'function' ? update(setup.distractionApps) : update,
      distractionDomains: [],
    }))
  }, [updateActiveSetup])

  useEffect(() => () => {
    if (testTimerRef.current) clearTimeout(testTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    if (testBlockingActiveRef.current) {
      pushCompanionSession({
        active: false,
        endTs: 0,
        blockedApps: [],
        blockedDomains: [],
      })
    }
  }, [])

  const stopTestBlocking = useCallback(() => {
    pushCompanionSession({
      active: false,
      endTs: 0,
      blockedApps: [],
      blockedDomains: [],
    })
    setTestFeedback('')
    testBlockingActiveRef.current = false
    setTestBlockingActive(false)
    testTimerRef.current = null
  }, [])

  const toggleFocusMode = () => {
    const next = !modeEnabled
    if (setFocusModeEnabled) setFocusModeEnabled(next)
    setLocalFocusModeEnabled(saveFocusModeEnabled(next))
  }

  const toggleStrictMode = () => updateActiveSetup({ strictMode: !strictMode })

  const handleInstallWebsiteHelper = async () => {
    setHelperInstallState({ status: 'installing', error: '' })
    const result = await installCompanionHelper()
    if (result.ok) {
      setHelperInstallState({ status: 'installed', error: '' })
      return
    }
    setHelperInstallState({
      status: 'error',
      error: result.error === 'cancelled' ? 'You cancelled the password prompt.' : result.error,
    })
  }

  // The entire library is one draft. Switching setups never leaks or silently
  // saves one setup's rules into another. Both sides are compared in their
  // normalized (saved) shape: raw edits clear derived domains, so a raw
  // comparison would stay dirty after adding and removing the same app.
  // Names are compared as typed, so clearing a name is always a change.
  const hasUnsavedChanges = useMemo(
    () => protectionDraftKey(savedProtectionState) !== protectionDraftKey(protectionState),
    [savedProtectionState, protectionState],
  )

  const handleBack = () => {
    if (hasUnsavedChanges && !confirmingBack) {
      setConfirmingBack(true)
      return
    }
    onBack()
  }

  const handleSaveAndBack = () => {
    if (handleSave()) onBack()
  }

  const handleSave = () => {
    if (invalidNameSetup) {
      setEditingSetupId(invalidNameSetup.id)
      setNameErrorVisible(true)
      setConfirmingBack(false)
      return false
    }
    const next = saveProtectionSetups(protectionState)
    setProtectionState(next)
    setSavedProtectionState(next)
    onProtectionStateChange?.(next)
    setConfirmingBack(false)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => {
      setSaved(false)
      savedTimerRef.current = null
    }, 1800)
    return true
  }

  const handleTestBlocking = async () => {
    if (testTimerRef.current) clearTimeout(testTimerRef.current)

    const blockedApps = distractionApps
    const blockedDomains = [...new Set(domainsFor(distractionApps))]
    const ok = await pushCompanionSession({
      active: true,
      endTs: Date.now() + 60_000,
      blockedApps,
      blockedDomains,
      strictMode,
      allowedApps: focusApps,
    })
    if (!ok) {
      testBlockingActiveRef.current = false
      setTestBlockingActive(false)
      setTestFeedback('Companion not reachable')
      return
    }
    testBlockingActiveRef.current = true
    setTestBlockingActive(true)
    setTestFeedback('Test session active for 60s')

    testTimerRef.current = setTimeout(stopTestBlocking, 60_000)
  }

  const resetEditorInputs = () => {
    setFocusInput('')
    setDistractionInput('')
    setSaved(false)
  }

  const selectSetup = (setupId) => {
    setEditingSetupId(setupId)
    resetEditorInputs()
  }

  const chooseSetupForSessions = () => {
    setProtectionState(current => ({ ...current, activeSetupId: activeSetup.id }))
    setSaved(false)
  }

  // New and duplicated setups open in the editor without becoming the session
  // setup; that stays an explicit choice.
  const openCreatedSetup = (next, previous) => {
    const previousIds = new Set(previous.setups.map(setup => setup.id))
    const created = next.setups.find(setup => !previousIds.has(setup.id))
    setProtectionState(next)
    if (created) setEditingSetupId(created.id)
    resetEditorInputs()
  }

  const addSetup = () => {
    openCreatedSetup(createProtectionSetup(protectionState, { activate: false }), protectionState)
  }

  const duplicateSetup = () => {
    openCreatedSetup(createProtectionSetup(protectionState, { copyFromId: activeSetup.id, activate: false }), protectionState)
  }

  const confirmDeleteSetup = () => {
    if (!setupPendingDeletion) return
    const removedIndex = protectionState.setups.findIndex(setup => setup.id === setupPendingDeletion.id)
    const next = removeProtectionSetup(protectionState, setupPendingDeletion.id)
    setProtectionState(next)
    if (setupPendingDeletion.id === activeSetup.id && next.setups.length) {
      setEditingSetupId(next.setups[Math.min(Math.max(removedIndex, 0), next.setups.length - 1)].id)
    }
    setSetupPendingDeletion(null)
    resetEditorInputs()
  }

  return (
    <main className="protection-page">
      <header className="protection-heading">
        <div>
          <span>Digital environment</span>
          <h1>Protection</h1>
          <p>Decide what stays available when your focus session begins.</p>
        </div>
        {confirmingBack ? (
          <div className="protection-leave-actions">
            <span>Unsaved changes</span>
            <button type="button" className="is-primary" onClick={handleSaveAndBack}>Save &amp; leave</button>
            <button type="button" onClick={onBack}>Discard</button>
          </div>
        ) : (
          <button type="button" className="protection-back" onClick={handleBack}>Back</button>
        )}
      </header>

      <div className="protection-layout">
        <aside className="protection-library" aria-label="Protection setups">
          <div className="protection-library-heading">
            <span>Setups</span>
            <small>{protectionState.setups.length}</small>
          </div>
          <div className="protection-setup-list">
            {protectionState.setups.map(setup => {
              const active = setup.id === activeSetup.id
              const usedForSessions = setup.id === protectionState.activeSetupId
              return (
                <button
                  key={setup.id}
                  type="button"
                  className={`${active ? 'is-active' : ''}${usedForSessions ? ' is-session-setup' : ''}`}
                  aria-pressed={active}
                  onClick={() => selectSetup(setup.id)}
                >
                  <span className="protection-setup-mark" />
                  <strong>{setup.name.trim() || 'Untitled setup'}</strong>
                  <small>{usedForSessions ? 'Used for sessions · ' : ''}{setup.focusApps.length} allowed · {setup.distractionApps.length} unavailable</small>
                </button>
              )
            })}
          </div>
          <button type="button" className="protection-add-setup" onClick={addSetup}>+ New setup</button>
        </aside>

        <section className="protection-editor" aria-label={`Edit ${activeSetup.name}`}>
          <header className="protection-editor-heading">
            <label>
              <span>Setup name</span>
              <input
                value={activeSetup.name}
                maxLength={48}
                onChange={event => {
                  updateActiveSetup({ name: event.target.value.slice(0, 48) })
                  setNameErrorVisible(true)
                }}
                aria-label="Setup name"
                aria-invalid={nameIssue ? 'true' : 'false'}
                aria-describedby={nameIssue && nameErrorVisible ? 'protection-setup-name-error' : undefined}
              />
              {nameIssue && nameErrorVisible && (
                <em id="protection-setup-name-error" className="protection-name-error" role="alert">
                  {nameIssue === 'blank' ? 'Give this setup a name.' : 'Another setup already uses this name.'}
                </em>
              )}
            </label>
            <div className="protection-editor-actions">
              {isSessionSetup
                ? <span className="protection-session-badge">Used for sessions</span>
                : <button type="button" onClick={chooseSetupForSessions}>Use for sessions</button>}
              <button type="button" onClick={duplicateSetup}>Duplicate</button>
              <button
                type="button"
                className="is-danger"
                disabled={protectionState.setups.length === 1}
                onClick={() => setSetupPendingDeletion(activeSetup)}
              >
                Delete
              </button>
            </div>
          </header>

          <section className={`protection-readiness is-${readiness.state}${protectionReady ? ' is-ready' : ''}`}>
            <div className="protection-readiness-icon" aria-hidden="true"><i /></div>
            <div>
              <span>{{
                off: 'Protection is off',
                empty: 'Protection not configured',
                checking: 'Checking the Companion',
                disconnected: 'Companion not connected',
                permission: 'Automation permission required',
                helper: 'Website helper required',
                ready: 'Ready for focus',
              }[readiness.state]}</span>
              <p>
                {protectionReady
                  ? strictMode
                    ? `${activeSetup.name} will hide every non-browser app outside ${focusApps.length ? `${focusApps.length} allowed ${focusApps.length === 1 ? 'tool' : 'tools'} and core system apps` : 'core system apps'}.`
                    : `${activeSetup.name} will keep ${focusApps.length} ${focusApps.length === 1 ? 'tool' : 'tools'} available and make ${distractionApps.length} ${distractionApps.length === 1 ? 'distraction' : 'distractions'} unavailable.`
                  : {
                    off: 'Your rules are saved, but sessions will not enforce them.',
                    empty: 'Add at least one distraction below or choose Strict protection.',
                    checking: 'Rules are set. Verifying that the Companion can enforce them.',
                    disconnected: 'Rules are set, but nothing is enforced until the Companion app is running.',
                    permission: `Enable Eudaimonai Companion Automation access for ${readiness.permissionMissing} in System Settings so ${readiness.permissionScope === 'system' ? 'these rules can be enforced' : 'blocked websites can be closed there'}.`,
                    helper: 'Install the website blocking helper below so websites can be blocked.',
                  }[readiness.state]}
              </p>
            </div>
            <button
              type="button"
              className="protection-switch"
              role="switch"
              aria-label="Protection during focus sessions"
              aria-checked={modeEnabled}
              onClick={toggleFocusMode}
            >
              <span />
            </button>
          </section>

          {readiness.state === 'helper' && (
            <section className="protection-helper-setup" aria-labelledby="website-helper-heading">
              <div>
                <h2 id="website-helper-heading">Enable website blocking</h2>
                <p>Enter your Mac password once. The helper only updates Eudaimonai’s website block list, so sessions do not need another password prompt.</p>
                {helperInstallState.error && <span role="alert">{helperInstallState.error}</span>}
              </div>
              <button
                type="button"
                onClick={handleInstallWebsiteHelper}
                disabled={helperInstallState.status === 'installing'}
              >
                {helperInstallState.status === 'installing' ? 'Waiting for password…' : 'Install helper'}
              </button>
            </section>
          )}

          <fieldset className="protection-strength">
            <legend>Protection level</legend>
            <div>
              <button type="button" className={!strictMode ? 'is-active' : ''} aria-pressed={!strictMode} onClick={() => strictMode && toggleStrictMode()}>
                <strong>Selected</strong>
                <span>Only the distractions below become unavailable.</span>
              </button>
              <button type="button" className={strictMode ? 'is-active' : ''} aria-pressed={strictMode} onClick={() => !strictMode && toggleStrictMode()}>
                <strong>Strict</strong>
                <span>Every non-browser app outside your allowed tools is hidden.</span>
              </button>
            </div>
          </fieldset>

          {configuredCount === 0 && !rulesConfigured && (
            <div className="protection-empty-guide">
              <span>Start simple</span>
              <p>Add the tools this setup needs, then remove the places that usually pull you away.</p>
            </div>
          )}

          <div className="protection-rule-list">
            <AppSection
              title="Available during focus"
              subtitle="The tools and sites that support this type of work."
              apps={focusApps}
              setApps={setFocusApps}
              presets={FOCUS_PRESETS}
              inputValue={focusInput}
              setInputValue={setFocusInput}
              tone="focus"
            />
            <div className="protection-rule-divider" />
            <AppSection
              title="Unavailable during focus"
              subtitle="Apps and sites that should step out of the way."
              apps={distractionApps}
              setApps={setDistractionApps}
              presets={DISTRACTION_PRESETS}
              inputValue={distractionInput}
              setInputValue={setDistractionInput}
              tone="block"
            />
          </div>

          <section className="protection-blocking-test" aria-labelledby="blocking-test-heading">
            <div>
              <h2 id="blocking-test-heading">Test this setup</h2>
              <p>Temporarily enforce the current draft for 60 seconds before using it in a session.</p>
              {testFeedback && <span className="protection-test-feedback" role="status">{testFeedback}</span>}
            </div>
            <button type="button" onClick={handleTestBlocking} disabled={testBlockingActive || !rulesConfigured}>
              {testBlockingActive ? 'Test active' : 'Test for 60s'}
            </button>
          </section>

          <footer className="protection-save-row">
            <span>{invalidNameSetup && hasUnsavedChanges ? 'Name every setup before saving' : hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}</span>
            <button type="button" disabled={(!hasUnsavedChanges && !saved) || Boolean(invalidNameSetup)} onClick={handleSave}>
              {saved ? 'Saved' : 'Save setup'}
            </button>
          </footer>
        </section>
      </div>

      {SHOW_NATIVE_CAMERA_DIAGNOSTICS && (
        <details className="protection-internal-diagnostics">
          <summary>Internal camera diagnostics</summary>
          <NativeCameraDiagnostics />
        </details>
      )}

      {setupPendingDeletion && (
        <ConfirmDialog
          title={`Delete “${setupPendingDeletion.name.trim() || 'Untitled setup'}”?`}
          description="Its allowed tools, unavailable distractions and protection level will be removed. Other setups stay unchanged."
          confirmLabel="Delete setup"
          onConfirm={confirmDeleteSetup}
          onCancel={() => setSetupPendingDeletion(null)}
        />
      )}
    </main>
  )
}
