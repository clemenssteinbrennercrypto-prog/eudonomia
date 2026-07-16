import { useState, useEffect, useCallback } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import LandingPage from './components/LandingPage'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import WorkspaceSetup from './components/WorkspaceSetup'
import FocusAppsScreen from './components/FocusAppsScreen'
import SessionScreen from './components/SessionScreen'
import EndScreen from './components/EndScreen'
import HistoryDashboard from './components/HistoryDashboard'
import { loadFocusModeEnabled, saveFocusModeEnabled, saveSession } from './lib/storage'
import { normalizeWorkspaceObjects } from './lib/workspaceObjects'
import { useAppUpdateStatus } from './lib/useUpdateAvailable'

const isNativeRuntime = () => Boolean(window.__TAURI__?.core?.invoke)

function getInitialFlow() {
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
      ? 'A signed native app update is available. Reload only refreshes the current bundled UI.'
      : 'Reload refreshes this local development build.'
    : error
      ? `Update check unavailable: ${error}. Reload refreshes the current app only.`
      : 'Reload refreshes the current app without claiming a new version.'

  return (
    <div className="app-refresh-control" title={title}>
      <button
        className="app-refresh-button"
        type="button"
        onClick={reloadCurrentApp}
        aria-label="Reload current Eudonomia app"
      >
        <span className="app-refresh-icon" aria-hidden="true">↻</span>
        <span>Reload</span>
      </button>
      <span className={`app-refresh-status ${updateAvailable ? 'is-update' : ''}`}>
        {statusText}
      </span>
      {isNative && updateAvailable && (
        <button
          className="app-update-button"
          type="button"
          onClick={installNativeUpdate}
          disabled={installing}
          aria-label="Install native Eudonomia update"
        >
          {installing ? 'Installing' : 'Install'}
        </button>
      )}
    </div>
  )
}

export default function App() {
  // Public web stays marketing/download only. Native and local dev expose the app.
  const [flow, setFlow] = useState(getInitialFlow)
  const [screen,   setScreen]   = useState('home')
  const [task,     setTask]     = useState('')
  const [goal,     setGoal]     = useState('')
  const [duration, setDuration] = useState(30)
  const [tags,     setTags]     = useState([])
  const [sessionData, setSessionData] = useState(null)
  const [devices,  setDevicesRaw] = useState(loadDevices)
  const [focusModeEnabled, setFocusModeEnabledRaw] = useState(loadFocusModeEnabled)
  const updateStatus = useAppUpdateStatus()

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
    const enriched = { ...data, task, goal, tags }
    saveSession(enriched)
    setSessionData(enriched)
    setScreen('end')
  }, [task, goal, tags])

  const handleRestart = (prefill = null) => {
    setTask(prefill?.task ?? '')
    setGoal(prefill?.goal ?? '')
    setDuration(prefill?.duration ?? 30)
    setTags(prefill?.tags ?? [])
    setSessionData(null)
    setScreen('home')
  }

  if (flow === 'landing') {
    return <LandingPage />
  }

  if (flow === 'onboarding') {
    return (
      <>
        <AppRefreshControl updateStatus={updateStatus} />
        <Onboarding onComplete={() => {
          setFlow('app')
          if (loadDevices().length === 0) setScreen('setup')
        }} />
      </>
    )
  }

  return (
    <>
      <AppRefreshControl updateStatus={updateStatus} />
      {screen === 'home' && (
        <HomeScreen
          task={task}
          setTask={setTask}
          goal={goal}
          setGoal={setGoal}
          duration={duration}
          setDuration={setDuration}
          tags={tags}
          setTags={setTags}
          devices={devices}
          focusModeEnabled={focusModeEnabled}
          setFocusModeEnabled={setFocusModeEnabled}
          onStart={handleStart}
          onShowHistory={() => setScreen('history')}
          onShowSetup={() => setScreen('setup')}
          onShowFocusApps={() => setScreen('focus-apps')}
        />
      )}
      {screen === 'focus-apps' && (
        <FocusAppsScreen
          focusModeEnabled={focusModeEnabled}
          setFocusModeEnabled={setFocusModeEnabled}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'setup' && (
        <WorkspaceSetup
          devices={devices}
          setDevices={setDevices}
          onContinue={() => setScreen('home')}
        />
      )}
      {screen === 'session' && (
        <SessionScreen
          task={task}
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
        <HistoryDashboard onClose={() => setScreen('home')} />
      )}
    </>
  )
}
