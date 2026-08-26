import { useState, useEffect, useCallback, useRef } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import LandingPage from './components/LandingPage'
import Onboarding from './components/Onboarding'
import SessionIntentScreen from './components/SessionIntentScreen'
import LabDashboard from './components/LabDashboard'
import AppShell from './components/AppShell'
import WorkspaceSetup from './components/WorkspaceSetup'
import FocusAppsScreen from './components/FocusAppsScreen'
import SessionScreen from './components/SessionScreen'
import EndScreen from './components/EndScreen'
import HistoryDashboard from './components/HistoryDashboard'
import { backfillFocusLedgerFromSessions, loadFocusModeEnabled, saveFocusModeEnabled, saveSession } from './lib/storage'
import { normalizeWorkspaceObjects } from './lib/workspaceObjects'
import { useAppUpdateStatus } from './lib/useUpdateAvailable'
import { withSessionFocusMetric } from './lib/focusMetric'

const isNativeRuntime = () => Boolean(window.__TAURI__?.core?.invoke)

const bundledBuildInfo = {
  version: import.meta.env.VITE_EUDONOMIA_BUILD_VERSION || '',
  channel: import.meta.env.VITE_EUDONOMIA_BUILD_CHANNEL || '',
  buildId: import.meta.env.VITE_EUDONOMIA_BUILD_ID || '',
  shortSha: import.meta.env.VITE_EUDONOMIA_BUILD_SHORT_SHA || '',
}

function getInitialFlow() {
  // ?onboarding=1 forces the intro flow — lets you re-experience the first-run
  // moment even after you've onboarded (handy for demos/testing).
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('onboarding')) {
    return 'onboarding'
  }
  if (!isNativeRuntime() && !import.meta.env.DEV) return 'landing'
  return localStorage.getItem('eudaimonia_onboarded') === 'true' ? 'app' : 'onboarding'
}

// ── Persist helpers ───────────────────────────────────────────────────────────
function loadDevices() {
  try {
    const raw = JSON.parse(localStorage.getItem('eudaimonia_devices') || '[]')
    // Migrate: discard old format entries that have `position` string instead of col/row
    return normalizeWorkspaceObjects(raw)
  } catch { return [] }
}
function saveDevices(devices) {
  try { localStorage.setItem('eudaimonia_devices', JSON.stringify(normalizeWorkspaceObjects(devices))) }
  catch {}
}

function AppRefreshControl({ updateStatus }) {
  const {
    runtime,
    checking,
    installing,
    updateAvailable,
    updateVersion,
    error,
    reloadCurrentApp,
    installNativeUpdate,
  } = updateStatus

  const isNative = runtime === 'native'
  const versionText = updateVersion ? ` ${updateVersion}` : ''
  const primaryAction = isNative && updateAvailable ? installNativeUpdate : reloadCurrentApp
  const primaryLabel = isNative && updateAvailable
    ? installing ? 'Installing' : 'Update'
    : 'Reload'
  const statusText = installing
    ? 'Installing update...'
    : updateAvailable
      ? `${isNative ? 'Native' : 'Web'} update${versionText}`
      : checking
        ? 'Checking updates...'
        : error
          ? 'Reload only'
          : isNative
            ? 'Native app up to date'
            : 'Reload current app'

  const title = updateAvailable
    ? isNative
      ? 'A native app update is available. Update installs a newer app bundle; Reload only refreshes the current UI.'
      : 'Reload refreshes this local development build.'
    : error
      ? `Update check unavailable: ${error}. Reload refreshes the current app only.`
      : 'Reload refreshes the current app without claiming a new version.'

  return (
    <div className="app-refresh-control" title={title}>
      <button
        className="app-refresh-button"
        type="button"
        onClick={primaryAction}
        disabled={installing}
        aria-label={isNative && updateAvailable ? 'Install native Eudonomia update' : 'Reload current Eudonomia app'}
      >
        <span className="app-refresh-icon" aria-hidden="true">↻</span>
        <span>{primaryLabel}</span>
      </button>
      <span className={`app-refresh-status ${updateAvailable ? 'is-update' : ''}`}>
        {statusText}
      </span>
      {isNative && updateAvailable && (
        <button
          className="app-update-button"
          type="button"
          onClick={reloadCurrentApp}
          disabled={installing}
          aria-label="Reload current Eudonomia app without installing the available native update"
        >
          Reload only
        </button>
      )}
    </div>
  )
}

function BuildIdentity() {
  const [info, setInfo] = useState(bundledBuildInfo)
  const [justUpdatedFrom, setJustUpdatedFrom] = useState(null)

  useEffect(() => {
    let cancelled = false

    fetch('./build-info.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.version) {
          setInfo({
            version: data.version,
            channel: data.channel || bundledBuildInfo.channel,
            buildId: data.buildId || bundledBuildInfo.buildId,
            shortSha: data.shortSha || bundledBuildInfo.shortSha,
          })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const version = info.version
    if (!version) return

    const storageKey = 'eudonomia_last_seen_build_version'
    const lastSeen = localStorage.getItem(storageKey)

    if (lastSeen && lastSeen !== version) {
      setJustUpdatedFrom(lastSeen)
      const timeoutId = window.setTimeout(() => setJustUpdatedFrom(null), 12000)
      localStorage.setItem(storageKey, version)
      return () => window.clearTimeout(timeoutId)
    }

    if (!lastSeen) {
      localStorage.setItem(storageKey, version)
    }
  }, [info.version])

  const version = info.version || 'dev'
  const build = info.shortSha || info.buildId || 'local'
  const channel = info.channel ? `${info.channel} ` : ''

  return (
    <>
      <div className="app-build-identity" title={info.buildId || build}>
        {channel}v{version} · {build}
      </div>
      {justUpdatedFrom && (
        <div className="app-update-toast" role="status" aria-live="polite">
          Updated from v{justUpdatedFrom} to v{version}
        </div>
      )}
    </>
  )
}

export default function App() {
  // Public web stays marketing/download only. Native and local dev expose the app.
  const [flow, setFlow] = useState(getInitialFlow)
  const [screen,   setScreen]   = useState('lab')
  const [task,     setTask]     = useState('')
  const [goal,     setGoal]     = useState('')
  const [energyLevel, setEnergyLevel] = useState('medium')
  const [duration, setDuration] = useState(30)
  const [tags,     setTags]     = useState([])
  const [sessionData, setSessionData] = useState(null)
  const [devices,  setDevicesRaw] = useState(loadDevices)
  const [focusModeEnabled, setFocusModeEnabledRaw] = useState(loadFocusModeEnabled)
  const updateStatus = useAppUpdateStatus()

  // Runs once per app start, before Home's first read of the ledger — catches
  // up any already-stored session that qualifies for the score but never made
  // it into the ledger (e.g. saved by a build older than this ledger).
  const backfilledRef = useRef(false)
  if (!backfilledRef.current) {
    backfilledRef.current = true
    backfillFocusLedgerFromSessions()
  }

  const setDevices = useCallback((val) => {
    setDevicesRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      const normalized = normalizeWorkspaceObjects(next)
      saveDevices(normalized)
      return normalized
    })
  }, [])

  const setFocusModeEnabled = useCallback((val) => {
    setFocusModeEnabledRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      return saveFocusModeEnabled(next)
    })
  }, [])

  const handleStart = () => setScreen('session')

  const handleEnd = useCallback((data) => {
    const enriched = withSessionFocusMetric({ ...data, task, goal, energyLevel, tags })
    const saved = saveSession(enriched)
    setSessionData(saved)
    setScreen('end')
  }, [task, goal, energyLevel, tags])

  const handleRestart = (prefill = null) => {
    setTask(prefill?.task ?? '')
    setGoal(prefill?.goal ?? '')
    setEnergyLevel(prefill?.energyLevel ?? 'medium')
    setDuration(prefill && Object.hasOwn(prefill, 'duration') ? prefill.duration : 30)
    setTags(prefill?.tags ?? [])
    setSessionData(null)
    setScreen('session-setup')
  }

  if (flow === 'landing') {
    return <LandingPage />
  }

  if (flow === 'onboarding') {
    return (
      <>
        <AppRefreshControl updateStatus={updateStatus} />
        <BuildIdentity />
        <Onboarding onComplete={() => {
          setFlow('app')
          if (loadDevices().length === 0) setScreen('setup')
          else setScreen('lab')
        }} />
      </>
    )
  }

  const content = (
    <div key={screen} className="screen-enter">
      {screen === 'lab' && (
        <LabDashboard
          focusModeEnabled={focusModeEnabled}
          onSession={() => setScreen('session-setup')}
          onProtection={() => setScreen('focus-apps')}
          onAnalytics={() => setScreen('history')}
        />
      )}
      {screen === 'session-setup' && (
        <SessionIntentScreen
          task={task}
          setTask={setTask}
          goal={goal}
          setGoal={setGoal}
          energyLevel={energyLevel}
          setEnergyLevel={setEnergyLevel}
          duration={duration}
          setDuration={setDuration}
          tags={tags}
          setTags={setTags}
          onStart={handleStart}
        />
      )}
      {screen === 'focus-apps' && (
        <FocusAppsScreen
          focusModeEnabled={focusModeEnabled}
          setFocusModeEnabled={setFocusModeEnabled}
          onBack={() => setScreen('lab')}
        />
      )}
      {screen === 'setup' && (
        <WorkspaceSetup
          devices={devices}
          setDevices={setDevices}
          onContinue={() => setScreen('lab')}
        />
      )}
      {screen === 'session' && (
        <SessionScreen
          task={task}
          goal={goal}
          energyLevel={energyLevel}
          tags={tags}
          duration={duration}
          devices={devices}
          focusModeEnabled={focusModeEnabled}
          onEnd={handleEnd}
        />
      )}
      {screen === 'end' && (
        <EndScreen
          sessionData={sessionData}
          onRestart={handleRestart}
          onShowHistory={() => setScreen('history')}
        />
      )}
      {screen === 'history' && (
        <HistoryDashboard onClose={() => setScreen('lab')} />
      )}
    </div>
  )

  const navigate = (destination) => {
    if (destination === 'lab' || destination === 'session-setup' || destination === 'setup' || destination === 'history') {
      setScreen(destination)
    }
  }

  return (
    <>
      {/* Hidden during a session: a reload tears down all in-memory session
          state (scores, streaks, timers live in refs), so hitting it mid-session
          silently destroys the run. There is no reason to reload while tracking,
          and an update can always wait until the session ends. */}
      <BuildIdentity />
      {screen === 'session'
        ? content
        : (
          <AppShell
            active={screen === 'focus-apps' ? 'lab' : screen}
            onNavigate={navigate}
            utility={<AppRefreshControl updateStatus={updateStatus} />}
          >
            {content}
          </AppShell>
        )}
    </>
  )
}
