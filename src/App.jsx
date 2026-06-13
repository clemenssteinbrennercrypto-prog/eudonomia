import { useState, useEffect, useCallback } from 'react'
import LandingPage from './components/LandingPage'
import Onboarding from './components/Onboarding'
import HomeScreen from './components/HomeScreen'
import WorkspaceSetup from './components/WorkspaceSetup'
import SessionScreen from './components/SessionScreen'
import EndScreen from './components/EndScreen'
import HistoryDashboard from './components/HistoryDashboard'
import { saveSession } from './lib/storage'

// ── Persist helpers ───────────────────────────────────────────────────────────
function loadDevices() {
  try {
    const raw = JSON.parse(localStorage.getItem('eudaimonia_devices') || '[]')
    // Migrate: discard old format entries that have `position` string instead of col/row
    return raw.filter(d => typeof d.col === 'number' && typeof d.row === 'number')
  } catch { return [] }
}
function saveDevices(devices) {
  try { localStorage.setItem('eudaimonia_devices', JSON.stringify(devices)) }
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
  const [sessionData, setSessionData] = useState(null)
  const [devices,  setDevicesRaw] = useState(loadDevices)

  const setDevices = useCallback((val) => {
    setDevicesRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      saveDevices(next)
      return next
    })
  }, [])

  const handleStart = () => setScreen('session')

  const handleEnd = useCallback((data) => {
    const enriched = { ...data, task, goal }
    saveSession(enriched)
    setSessionData(enriched)
    setScreen('end')
  }, [task, goal])

  const handleRestart = () => {
    setTask('')
    setGoal('')
    setDuration(30)
    setSessionData(null)
    setScreen('home')
  }

  if (flow === 'landing') {
    return <LandingPage onEnter={() => setFlow('onboarding')} />
  }

  if (flow === 'onboarding') {
    return <Onboarding onComplete={() => setFlow('app')} />
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
          devices={devices}
          onStart={handleStart}
          onShowHistory={() => setScreen('history')}
          onShowSetup={() => setScreen('setup')}
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
