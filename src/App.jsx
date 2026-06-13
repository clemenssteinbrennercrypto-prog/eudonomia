import { useState, useEffect, useCallback } from 'react'
import HomeScreen from './components/HomeScreen'
import SessionScreen from './components/SessionScreen'
import EndScreen from './components/EndScreen'
import HistoryDashboard from './components/HistoryDashboard'
import { saveSession } from './lib/storage'

function loadMonitorPositions() {
  try { return JSON.parse(localStorage.getItem('eudaimonia_monitor_positions') || '[]') }
  catch { return [] }
}

export default function App() {
  const [screen,           setScreen]           = useState('home')
  const [task,             setTask]             = useState('')
  const [duration,         setDuration]         = useState(30)
  const [sessionData,      setSessionData]      = useState(null)
  const [monitors,         setMonitorsRaw]      = useState(() => {
    const s = parseInt(localStorage.getItem('eudaimonia_monitors') || '1')
    return [1, 2, 3].includes(s) ? s : 1
  })
  const [monitorPositions, setMonitorPositions] = useState(loadMonitorPositions)

  useEffect(() => {
    localStorage.setItem('eudaimonia_monitors', String(monitors))
  }, [monitors])

  useEffect(() => {
    localStorage.setItem('eudaimonia_monitor_positions', JSON.stringify(monitorPositions))
  }, [monitorPositions])

  const setMonitors = useCallback((m) => {
    setMonitorsRaw(m)
    setMonitorPositions((prev) => {
      const needed = m - 1
      if (prev.length === needed) return prev
      if (prev.length > needed)  return prev.slice(0, needed)
      return [...prev, ...Array(needed - prev.length).fill('right')]
    })
  }, [])

  const handleStart = () => setScreen('session')

  const handleEnd = useCallback((data) => {
    // Attach task name + save to history
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
          monitors={monitors}
          setMonitors={setMonitors}
          monitorPositions={monitorPositions}
          setMonitorPositions={setMonitorPositions}
          onStart={handleStart}
          onShowHistory={() => setScreen('history')}
        />
      )}
      {screen === 'session' && (
        <SessionScreen
          task={task}
          duration={duration}
          monitorPositions={monitorPositions}
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
