import { useState, useEffect, useCallback } from 'react'
import HomeScreen from './components/HomeScreen'
import SetupScreen from './components/WorkspaceSetup'
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
  const [screen,   setScreen]   = useState('home')
  const [task,     setTask]     = useState('')
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
    const enriched = { ...data, task }
    saveSession(enriched)
    setSessionData(enriched)
    setScreen('end')
  }, [task])

  const handleRestart = () => {
    setTask('')
    setDuration(30)
    setSessionData(null)
    setScreen('home')
  }

  return (
    <>
      {screen === 'home' && (
        <HomeScreen
          task={task}
          setTask={setTask}
          duration={duration}
          setDuration={setDuration}
          devices={devices}
          onStart={handleStart}
          onShowHistory={() => setScreen('history')}
          onShowSetup={() => setScreen('setup')}
        />
      )}
      {screen === 'setup' && (
        <SetupScreen
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
