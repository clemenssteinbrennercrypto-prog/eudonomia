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
import { saveSession } from './lib/storage'
import { normalizeWorkspaceObjects } from './lib/workspaceObjects'

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

export default function App() {
  // 'landing' → 'onboarding' → 'app'
  const [flow, setFlow] = useState(
    () => localStorage.getItem('eudaimonia_onboarded') === 'true' ? 'app' : 'landing'
  )
  const [screen,   setScreen]   = useState('home')
  const [task,     setTask]     = useState('')
  const [goal,     setGoal]     = useState('')
  const [duration, setDuration] = useState(30)
  const [tags,     setTags]     = useState([])
  const [sessionData, setSessionData] = useState(null)
  const [devices,  setDevicesRaw] = useState(loadDevices)

  const setDevices = useCallback((val) => {
    setDevicesRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      const normalized = normalizeWorkspaceObjects(next)
      saveDevices(normalized)
      return normalized
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
    return <LandingPage onEnter={() => setFlow('onboarding')} />
  }

  if (flow === 'onboarding') {
    return <Onboarding onComplete={() => {
      setFlow('app')
      if (loadDevices().length === 0) setScreen('setup')
    }} />
  }

  return (
    <>
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
          onStart={handleStart}
          onShowHistory={() => setScreen('history')}
          onShowSetup={() => setScreen('setup')}
          onShowFocusApps={() => setScreen('focus-apps')}
        />
      )}
      {screen === 'focus-apps' && (
        <FocusAppsScreen onBack={() => setScreen('home')} />
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
