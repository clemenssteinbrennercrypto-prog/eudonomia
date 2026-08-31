import { useState, useEffect, useCallback, useRef } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import LandingPage from './components/LandingPage'
import Onboarding from './components/Onboarding'
import SessionIntentScreen from './components/SessionIntentScreen'
import LabDashboard from './components/LabDashboard'
import AppShell from './components/AppShell'
import WorkspaceManager from './components/WorkspaceManager'
import FocusAppsScreen from './components/FocusAppsScreen'
import SessionScreen from './components/SessionScreen'
import EndScreen from './components/EndScreen'
import AnalyticsShell from './components/analytics/AnalyticsShell'
import { loadFocusModeEnabled, saveFocusModeEnabled } from './lib/storage'
import { sessionRepository } from './lib/sessionRepository'
import { createSessionPersister } from './lib/sessionPersistence'
import {
  getActiveWorkspace,
  loadWorkspaceState,
  saveWorkspaceState,
  workspaceDevices,
  workspaceSnapshot,
} from './lib/workspaceStore'
import { useAppUpdateStatus } from './lib/useUpdateAvailable'
import { emptyFocusLedger, withSessionFocusMetric } from './lib/focusMetric'
import { durationFromSetup } from './lib/sessionDuration'

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

function AppRefreshControl({ updateStatus }) {
  const {
    runtime,
    checking,
    installing,
    updateAvailable,
    updateVersion,
    error,
    reloadCurrentApp,
    reloadOrUpdate,
  } = updateStatus

  const isNative = runtime === 'native'
  const versionText = updateVersion ? ` ${updateVersion}` : ''
  const primaryAction = isNative ? reloadOrUpdate : reloadCurrentApp
  const primaryLabel = installing ? 'Installing' : 'Reload'
  const statusText = installing
    ? 'Installing update...'
    : updateAvailable
      ? `${isNative ? 'Native' : 'Web'} update${versionText}`
      : checking
        ? 'Checking updates...'
        : error
          ? 'Reload unavailable'
          : isNative
            ? 'Native app up to date'
            : 'Reload current app'

  const title = updateAvailable
    ? isNative
      ? 'Reload installs the available native app update and restarts Eudonomia.'
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
        aria-label={isNative ? 'Reload Eudonomia and install any available update' : 'Reload current Eudonomia app'}
      >
        <span className="app-refresh-icon" aria-hidden="true">↻</span>
        <span>{primaryLabel}</span>
      </button>
      <span className={`app-refresh-status ${updateAvailable ? 'is-update' : ''}`}>
        {statusText}
      </span>
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
  const [screen,   setScreen]   = useState(() => getActiveWorkspace(loadWorkspaceState()) ? 'lab' : 'setup')
  const [task,     setTask]     = useState('')
  const [goal,     setGoal]     = useState('')
  const [energyLevel, setEnergyLevel] = useState('medium')
  const [duration, setDuration] = useState(30)
  const [tags,     setTags]     = useState([])
  const [sessionData, setSessionData] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [migrationError, setMigrationError] = useState(null)
  const [historyLoadError, setHistoryLoadError] = useState(null)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [workspaceState, setWorkspaceStateRaw] = useState(loadWorkspaceState)
  const [focusModeEnabled, setFocusModeEnabledRaw] = useState(loadFocusModeEnabled)
  const updateStatus = useAppUpdateStatus()

  // Session history lives here rather than inside each screen: App already
  // owned `sessionRevision` to tell the dashboard when to re-read, so it is
  // the natural owner of the data that revision refers to. LabDashboard and
  // SessionIntentScreen render whatever they are handed.
  const [history, setHistory] = useState({ sessions: [], ledger: emptyFocusLedger() })
  useEffect(() => {
    let cancelled = false
    Promise.all([sessionRepository.loadAll(), sessionRepository.loadFocusLedger()])
      .then(([sessions, ledger]) => {
        if (!cancelled) {
          setHistory({ sessions, ledger })
          setHistoryLoadError(null)
        }
      })
      .catch(error => {
        if (!cancelled) setHistoryLoadError(String(error?.message || error))
      })
    return () => { cancelled = true }
  }, [sessionRevision])

  // Runs once per app start — catches up any already-stored session that
  // qualifies for the score but never made it into the ledger (e.g. saved by
  // a build older than this ledger). Bumping the revision on completion makes
  // the load above pick the caught-up ledger back up.
  // On the native build this first imports any localStorage history into
  // SQLite (idempotent, and it never deletes the old copy), then catches the
  // ledger up. Both are no-ops once there is nothing left to do.
  const backfilledRef = useRef(false)
  useEffect(() => {
    if (backfilledRef.current) return
    backfilledRef.current = true
    let cancelled = false
    sessionRepository.migrateLegacyIfNeeded()
      .then(result => {
        // A refused or unverified import is not a detail to swallow: it means
        // history is still only in the old store, and the user needs to know
        // why rather than being shown an app that looks empty.
        if (!cancelled && result && result.verified === false) {
          setMigrationError(result.reason || 'the import could not be verified')
        }
        return sessionRepository.backfillFocusLedger()
      })
      .then(() => { if (!cancelled) setSessionRevision(value => value + 1) })
      .catch(error => {
        if (!cancelled) setMigrationError(String(error?.message || error))
      })
    return () => { cancelled = true }
  }, [])

  const activeWorkspace = getActiveWorkspace(workspaceState)
  const devices = workspaceDevices(activeWorkspace)

  const setWorkspaceState = useCallback((next) => {
    const result = saveWorkspaceState(next)
    if (result.ok) setWorkspaceStateRaw(result.state)
    return result
  }, [])

  const setFocusModeEnabled = useCallback((val) => {
    setFocusModeEnabledRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      return saveFocusModeEnabled(next)
    })
  }, [])

  const handleStart = () => activeWorkspace ? setScreen('session') : setScreen('setup')

  // Owns the save and the check-in answers together, because only one place
  // can know whether the session has a stored row yet. See sessionPersistence.js.
  const persisterRef = useRef(null)
  if (!persisterRef.current) {
    persisterRef.current = createSessionPersister(sessionRepository)
  }

  // A finished session must never be lost to a failed write. The record is put
  // on screen from memory first; persistence is attempted after, and a failure
  // leaves a retry rather than silently discarding work the user just did.
  const persistSession = useCallback(async (enriched) => {
    try {
      // Comes back with any answers given while the write was in flight.
      setSessionData(await persisterRef.current.save(enriched))
      setSaveError(null)
      // LabDashboard caches its storage snapshot while mounted. Bump this after
      // every completed session so returning to Lab cannot show a stale ledger.
      setSessionRevision(value => value + 1)
      return true
    } catch (error) {
      setSaveError({ pending: enriched, message: String(error?.message || error) })
      return false
    }
  }, [])

  // The post-session check-in. Owned here rather than in EndScreen because a
  // component holding its own copy of the record cannot see the storage id
  // arrive — which is precisely how these answers used to get dropped.
  const handleOutcomeChange = useCallback(async (patch) => {
    setSessionData(previous => (previous ? { ...previous, ...patch } : previous))
    await persisterRef.current.edit(patch)
  }, [])

  const handleEnd = useCallback((data) => {
    const enriched = withSessionFocusMetric({
      ...data,
      task,
      goal,
      energyLevel,
      tags,
      workspace: workspaceSnapshot(activeWorkspace),
    })
    // A new session starts with no stored row and no carried-over answers.
    persisterRef.current.reset()
    setSessionData(enriched)
    setScreen('end')
    persistSession(enriched)
  }, [task, goal, energyLevel, tags, activeWorkspace, persistSession])

  const handleRestart = (prefill = null) => {
    setTask(prefill?.task ?? '')
    setGoal(prefill?.goal ?? '')
    setEnergyLevel(prefill?.energyLevel ?? 'medium')
    setDuration(durationFromSetup(prefill))
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
          if (!getActiveWorkspace(loadWorkspaceState())) setScreen('setup')
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
          sessions={history.sessions}
          ledger={history.ledger}
          onSession={() => setScreen('session-setup')}
          onProtection={() => setScreen('focus-apps')}
          onAnalytics={() => setScreen('analytics')}
        />
      )}
      {screen === 'session-setup' && (
        <SessionIntentScreen
          recentSessions={history.sessions}
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
          workspaces={workspaceState.workspaces}
          activeWorkspaceId={workspaceState.activeWorkspaceId}
          onWorkspaceChange={(id) => setWorkspaceState({ ...workspaceState, activeWorkspaceId: id })}
          onEditWorkspaces={() => setScreen('setup')}
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
        <WorkspaceManager
          state={workspaceState}
          onChange={setWorkspaceState}
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
          workspace={activeWorkspace}
          focusModeEnabled={focusModeEnabled}
          onEnd={handleEnd}
        />
      )}
      {screen === 'end' && (
        <>
          {saveError && (
            <div className="session-save-error" role="alert">
              <span>
                This session could not be saved ({saveError.message}). It is still
                here, but it will be lost if you close the app.
              </span>
              <button type="button" onClick={() => persistSession(saveError.pending)}>
                Retry save
              </button>
            </div>
          )}
          <EndScreen
            sessionData={sessionData}
            onOutcomeChange={handleOutcomeChange}
            onRestart={handleRestart}
            onPrimaryAction={() => setScreen('analytics')}
          />
        </>
      )}
      {screen === 'analytics' && (
        <AnalyticsShell onClose={() => setScreen('lab')} />
      )}
    </div>
  )

  const navigate = (destination) => {
    if (destination === 'lab' || destination === 'session-setup' || destination === 'setup' || destination === 'analytics') {
      setScreen(destination)
    }
  }

  return (
    <>
      {migrationError && screen !== 'session' && (
        <div className="session-save-error" role="alert">
          <span>
            Your history could not be imported into the new local database
            ({migrationError}). Nothing has been deleted — your sessions are
            still being read from their original storage, and the app will try
            the import again next launch.
          </span>
        </div>
      )}
      {historyLoadError && screen !== 'session' && (
        <div className="session-save-error" role="alert">
          <span>
            Your session history could not be loaded ({historyLoadError}). No data
            has been deleted. Retry after the local database becomes available.
          </span>
          <button type="button" onClick={() => setSessionRevision(value => value + 1)}>
            Retry history
          </button>
        </div>
      )}
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
