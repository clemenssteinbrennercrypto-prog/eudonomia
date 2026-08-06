import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchCompanionDebug,
  getActivitySourceStatus,
  getLastActivity,
  installCompanionHelper,
  isActivityConnected,
  pushCompanionSession,
  startActivityPolling,
  stopActivityPolling,
} from '../lib/activityReceiver'
import { getDomainsFromAppPreset } from '../lib/focusAppsConfig'
import { loadContractSettings, saveContractSettings, loadFocusAppsConfig, loadFocusModeEnabled, loadStrictMode, saveFocusAppsConfig, saveFocusModeEnabled, saveStrictMode } from '../lib/storage'

const FOCUS_PRESETS = ['VS Code', 'Figma', 'Terminal', 'Notion', 'Safari', 'Chrome']
const DISTRACTION_PRESETS = ['YouTube', 'Instagram', 'Twitter/X', 'TikTok', 'Reddit', 'Netflix']

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

function domainMatches(domain, candidates) {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return false
  return candidates.some(candidate => {
    const normalizedCandidate = normalizeDomain(candidate)
    return normalizedCandidate &&
      (normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`))
  })
}

function classifyCurrentActivity(activity, focusApps, distractionApps, connected) {
  if (!connected) return { kind: 'unknown', label: 'No activity detected' }
  const app = String(activity.app || '').trim()
  const appKey = app.toLowerCase()
  const domain = normalizeDomain(activity.domain || activity.full_url || activity.url)
  const domainKey = domain.toLowerCase()
  const focusKeys = new Set(focusApps.map(item => item.toLowerCase()))
  const distractionKeys = new Set(distractionApps.map(item => item.toLowerCase()))
  const focusDomains = domainsFor(focusApps)
  const distractionDomains = domainsFor(distractionApps)
  const label = domain || activity.title || app || 'Unknown'

  if (
    (appKey && distractionKeys.has(appKey)) ||
    (domainKey && distractionKeys.has(domainKey)) ||
    domainMatches(domain, distractionDomains)
  ) {
    return { kind: 'distraction', label }
  }
  if (
    (appKey && focusKeys.has(appKey)) ||
    (domainKey && focusKeys.has(domainKey)) ||
    domainMatches(domain, focusDomains)
  ) {
    return { kind: 'focus', label }
  }
  return { kind: 'unknown', label }
}

const TRACKING_STALE_MS = 12_000

function ageLabel(ts, now = Date.now()) {
  if (!ts) return 'never'
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.round(seconds / 60)}m ago`
}

function getProtectionStatus(debug, connected, now = Date.now()) {
  const sessionState = debug?.sessionState || (debug?.sessionActive ? 'active' : 'inactive')
  const sessionActive = connected && debug?.sessionActive === true && sessionState === 'active'
  const lastPollTs = debug?.lastPollTs || 0
  const lastActivityTs = debug?.lastActivity?.ts || 0
  const pollFresh = lastPollTs > 0 && now - lastPollTs <= TRACKING_STALE_MS
  const activityFresh = lastActivityTs > 0 && now - lastActivityTs <= TRACKING_STALE_MS
  const permissionMissing = debug?.permissionMissing
  const trackingActive = connected && pollFresh && activityFresh && !permissionMissing
  const trackingKnown = connected && lastPollTs > 0
  const blockedAppsCount = debug?.blockedAppsCount || 0
  const blockedDomainsCount = debug?.blockedDomainsCount || 0
  const strictMode = Boolean(debug?.strictMode)
  const appBlockingConfigured = blockedAppsCount > 0 || strictMode
  const websiteBlockingConfigured = blockedDomainsCount > 0
  const hostCancelled = debug?.hostBlockError === 'cancelled'
  const hostFailed = Boolean(debug?.hostBlockError && !hostCancelled)
  const hostActive = Boolean(debug?.hostBlockActive)

  const dimensions = [
    {
      label: 'Session',
      state: !connected
        ? 'off'
        : sessionState === 'active'
          ? 'active'
          : sessionState === 'paused'
            ? 'paused'
            : 'inactive',
      detail: !connected
        ? 'Companion not reachable.'
        : sessionState === 'active'
          ? `Running until ${debug?.sessionEndTs ? new Date(debug.sessionEndTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown end time'}.`
          : sessionState === 'paused'
            ? 'Paused. Blocking is intentionally off while paused.'
            : 'No active focus session. Blocking is off.',
    },
    {
      label: 'Tracking',
      state: !connected || permissionMissing
        ? 'unavailable'
        : trackingActive
          ? 'active'
          : trackingKnown
            ? 'stale'
            : 'unavailable',
      detail: permissionMissing
        ? `Missing Automation permission for ${permissionMissing}.`
        : trackingActive
          ? `Last activity ${ageLabel(lastActivityTs, now)}.`
          : trackingKnown
            ? `Last poll ${ageLabel(lastPollTs, now)}, last activity ${ageLabel(lastActivityTs, now)}.`
            : 'No native activity data yet.',
    },
    {
      label: 'Website blocking',
      state: !sessionActive || !websiteBlockingConfigured
        ? 'off'
        : hostActive
          ? 'active'
          : hostCancelled
            ? 'off'
            : hostFailed
              ? 'failed'
              : 'unconfirmed',
      detail: !sessionActive
        ? 'Off because there is no active session.'
        : !websiteBlockingConfigured
          ? 'No blocked websites are configured for this session.'
          : hostActive
            ? `${blockedDomainsCount} domain${blockedDomainsCount === 1 ? '' : 's'} blocked system-wide via /etc/hosts.`
            : hostCancelled
              ? 'Off because the admin password prompt was dismissed.'
              : hostFailed
                ? `Failed: ${debug.hostBlockError}`
                : 'Requested, but the companion has not confirmed the hosts block yet.',
    },
    {
      label: 'App blocking',
      state: !sessionActive || !appBlockingConfigured
        ? 'off'
        : permissionMissing
          ? 'failed'
          : trackingActive
            ? 'active'
            : 'unconfirmed',
      detail: !sessionActive
        ? 'Off because there is no active session.'
        : !appBlockingConfigured
          ? 'No blocked apps or strict allowlist are configured for this session.'
          : permissionMissing
            ? 'Cannot reliably hide apps without Automation permission.'
            : trackingActive
              ? strictMode
                ? `Strict mode is on; app hiding uses frontmost-app checks. ${blockedAppsCount} explicit blocked app${blockedAppsCount === 1 ? '' : 's'}.`
                : `${blockedAppsCount} blocked app${blockedAppsCount === 1 ? '' : 's'} configured. Enforcement is checked when an app becomes frontmost.`
              : 'Configured, but tracking is stale or not confirmed.',
    },
    {
      label: 'Helper',
      state: !connected ? 'unknown' : debug?.helperInstalled ? 'installed' : 'not installed',
      detail: !connected
        ? 'Cannot check helper installation until the companion is reachable.'
        : debug?.helperInstalled
          ? 'Silent website blocking helper is installed.'
          : 'Website blocking may require an admin prompt until the helper is installed.',
    },
    {
      label: 'Permissions',
      state: permissionMissing ? 'missing' : connected ? 'no known issue' : 'unknown',
      detail: permissionMissing
        ? `Enable Eudonomia Companion Automation access for ${permissionMissing} in System Settings.`
        : connected
          ? 'No Automation error reported by the companion.'
          : 'Cannot check permissions until the companion is reachable.',
    },
  ]

  const blockingConfigured = appBlockingConfigured || websiteBlockingConfigured
  const websiteOk = !websiteBlockingConfigured || hostActive
  const appOk = !appBlockingConfigured || (trackingActive && !permissionMissing)

  if (!connected) {
    return {
      level: 'off',
      title: 'Off',
      summary: 'Companion not reachable. Native tracking and blocking are off.',
      tone: 'red',
      dimensions,
    }
  }
  if (!sessionActive) {
    return {
      level: 'off',
      title: sessionState === 'paused' ? 'Off while paused' : 'Off',
      summary: sessionState === 'paused'
        ? 'The focus session is paused, so protection is intentionally off.'
        : 'No active focus session. The companion can track, but it is not enforcing blocking.',
      tone: 'yellow',
      dimensions,
    }
  }
  if (!trackingActive || permissionMissing || hostFailed || hostCancelled) {
    return {
      level: 'degraded',
      title: 'Degraded',
      summary: 'A session is active, but at least one required native signal is missing or failed.',
      tone: 'red',
      dimensions,
    }
  }
  if (!blockingConfigured) {
    return {
      level: 'tracking_only',
      title: 'Tracking only',
      summary: 'The companion is tracking activity, but no app or website blocking is configured.',
      tone: 'yellow',
      dimensions,
    }
  }
  if (websiteOk && appOk) {
    return {
      level: 'fully_protected',
      title: 'Fully protected',
      summary: 'All configured protection paths are active or have no known native failure.',
      tone: 'green',
      dimensions,
    }
  }
  return {
    level: 'partially_protected',
    title: 'Partially protected',
    summary: 'Some configured protection is active, but at least one path is off or not confirmed.',
    tone: 'yellow',
    dimensions,
  }
}

function statusColors(tone) {
  return {
    green: { border: 'rgba(47,227,168,0.20)', bg: 'rgba(47,227,168,0.10)', text: 'var(--good)', dot: 'var(--good)' },
    yellow: { border: 'rgba(255,179,64,0.20)', bg: 'rgba(255,179,64,0.09)', text: 'var(--warn)', dot: 'var(--warn)' },
    red: { border: 'rgba(255,77,106,0.20)', bg: 'rgba(255,77,106,0.10)', text: 'var(--bad)', dot: 'var(--bad)' },
  }[tone] || { border: 'var(--line)', bg: 'rgba(122,152,255,0.05)', text: 'var(--text-secondary)', dot: 'var(--text-muted)' }
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

function CompanionStatus() {
  const [debug, setDebug] = useState(null)
  const [connected, setConnected] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const next = await fetchCompanionDebug()
      if (cancelled) return
      setDebug(next)
      setConnected(Boolean(next))
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const runInstall = async () => {
    setInstalling(true)
    setInstallError(null)
    const res = await installCompanionHelper()
    setInstalling(false)
    if (!res.ok) {
      setInstallError(res.error === 'cancelled' ? 'You cancelled the password prompt.' : res.error)
    } else {
      const next = await fetchCompanionDebug()
      setDebug(next)
    }
  }

  const protection = getProtectionStatus(debug, connected)
  const colors = statusColors(protection.tone)
  const lastActivity = debug?.lastActivity
  const activityLabel = lastActivity?.domain || lastActivity?.app || null
  const websitesBlocked = debug?.hostBlockActive
  const helperInstalled = debug?.helperInstalled

  return (
    <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 540 }}>
      <section style={{
        border: `1.5px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        borderRadius: 14,
        padding: '13px 14px',
        display: 'grid',
        gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 950 }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: colors.dot,
                boxShadow: `0 0 0 3px ${colors.dot}28`,
                flexShrink: 0,
              }} />
              Protection: {protection.title}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 750, lineHeight: 1.45 }}>
              {protection.summary}
            </div>
          </div>
          <span style={{
            border: `1px solid ${colors.border}`,
            background: 'var(--surface)',
            borderRadius: 100,
            padding: '5px 9px',
            fontSize: 11,
            fontWeight: 900,
            whiteSpace: 'nowrap',
          }}>
            {protection.level.replace('_', ' ')}
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 8,
        }}>
          {protection.dimensions.map(item => (
            <div
              key={item.label}
              style={{
                border: '1px solid rgba(122,152,255,0.12)',
                background: 'rgba(122,152,255,0.06)',
                borderRadius: 10,
                padding: '9px 10px',
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 950, color: 'var(--ultra-bright)' }}>{item.label}</div>
              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 900, color: colors.text }}>{item.state}</div>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 650, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                {item.detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      {connected && !helperInstalled && (
        <div style={{
          border: '1px solid #93c5fd',
          background: 'rgba(122,152,255,0.09)',
          color: 'var(--ultra-bright)',
          borderRadius: 12,
          padding: '12px 14px',
          display: 'grid',
          gap: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>⚡ Frictionless blocking (one-time setup)</div>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.5, color: 'var(--ultra-bright)' }}>
            Enter your Mac password <b>once</b> to let Eudonomia block distraction sites silently — no password on every session. It installs a small helper that only edits your block list.
          </div>
          <button
            onClick={runInstall}
            disabled={installing}
            style={{
              justifySelf: 'start',
              border: 'none',
              borderRadius: 9,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 900,
              cursor: installing ? 'default' : 'pointer',
              background: installing ? '#93c5fd' : 'var(--ultra-bright)',
              color: 'var(--text)',
            }}
          >
            {installing ? 'Waiting for password…' : 'Enable — enter password once'}
          </button>
          {installError && (
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--bad)' }}>⚠ {installError}</div>
          )}
        </div>
      )}

      {connected && helperInstalled && (
        <div style={{ color: 'var(--good)', fontSize: 11, fontWeight: 800 }}>
          Silent website blocking helper installed; no password prompt expected per session.
        </div>
      )}

      {connected && debug?.sessionActive && websitesBlocked && (
        <div style={{ color: 'var(--good)', fontSize: 11, fontWeight: 800 }}>
          Website blocking is confirmed system-wide via /etc/hosts.
        </div>
      )}

      {connected && (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, lineHeight: 1.4 }}>
          {activityLabel ? `Last activity: ${activityLabel}` : 'Last activity: none yet'}
          {debug?.lastOsascriptError ? ` · osascript: ${debug.lastOsascriptError}` : ''}
        </div>
      )}
    </div>
  )
}

export default function FocusAppsScreen({ onBack, focusModeEnabled, setFocusModeEnabled }) {
  const initial = useMemo(() => loadFocusAppsConfig(), [])
  const [focusApps, setFocusApps] = useState(initial.focusApps)
  const [distractionApps, setDistractionApps] = useState(initial.distractionApps)
  const [focusInput, setFocusInput] = useState('')
  const [distractionInput, setDistractionInput] = useState('')
  const [saved, setSaved] = useState(false)
  // Mirrors what is actually persisted, so we can tell edited from saved.
  const [savedConfig, setSavedConfig] = useState({
    focusApps: initial.focusApps,
    distractionApps: initial.distractionApps,
  })
  const [confirmingBack, setConfirmingBack] = useState(false)
  const [strictMode, setStrictMode] = useState(() => loadStrictMode())
  const [localFocusModeEnabled, setLocalFocusModeEnabled] = useState(() => loadFocusModeEnabled())
  const [activity, setActivity] = useState(() => getLastActivity())
  const [activitySources, setActivitySources] = useState(() => getActivitySourceStatus())
  const [activityConnected, setActivityConnected] = useState(() => isActivityConnected())
  const [testFeedback, setTestFeedback] = useState('')
  const [testBlockingActive, setTestBlockingActive] = useState(false)
  const [contract, setContract] = useState(loadContractSettings)
  const testTimerRef = useRef(null)
  const testBlockingActiveRef = useRef(false)
  const savedTimerRef = useRef(null)

  const configuredCount = focusApps.length + distractionApps.length
  const modeEnabled = focusModeEnabled ?? localFocusModeEnabled
  const activityPreview = useMemo(
    () => classifyCurrentActivity(activity, focusApps, distractionApps, activityConnected),
    [activity, focusApps, distractionApps, activityConnected]
  )

  useEffect(() => {
    startActivityPolling((nextActivity) => {
      setActivity(nextActivity)
      setActivitySources(getActivitySourceStatus())
      setActivityConnected(isActivityConnected())
    })
    const heartbeat = setInterval(() => {
      setActivity(getLastActivity())
      setActivitySources(getActivitySourceStatus())
      setActivityConnected(isActivityConnected())
    }, 1000)
    return () => {
      clearInterval(heartbeat)
      stopActivityPolling()
    }
  }, [])

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

  const toggleStrictMode = () => {
    setStrictMode(saveStrictMode(!strictMode))
  }

  // Leaving this screen used to discard unsaved edits without a word, while the
  // header meanwhile counted them as if they were live ("1 focus apps · 1
  // blocked"). Track what's actually on disk so Back can say something.
  const savedSnapshot = JSON.stringify({
    focusApps: [...savedConfig.focusApps].sort(),
    distractionApps: [...savedConfig.distractionApps].sort(),
  })
  const hasUnsavedChanges = savedSnapshot !== JSON.stringify({
    focusApps: [...focusApps].sort(),
    distractionApps: [...distractionApps].sort(),
  })

  const handleBack = () => {
    if (hasUnsavedChanges && !confirmingBack) {
      setConfirmingBack(true)
      return
    }
    onBack()
  }

  const handleSaveAndBack = () => {
    handleSave()
    onBack()
  }

  const handleSave = () => {
    const next = saveFocusAppsConfig({ focusApps, distractionApps })
    setFocusApps(next.focusApps)
    setDistractionApps(next.distractionApps)
    setSavedConfig({ focusApps: next.focusApps, distractionApps: next.distractionApps })
    setConfirmingBack(false)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => {
      setSaved(false)
      savedTimerRef.current = null
    }, 1800)
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

  const activityRuntimeLabel = activitySources.primarySource === 'companion'
    ? 'Native Companion'
    : activitySources.primarySource === 'extension'
      ? 'Legacy browser extension fallback'
      : 'Native Companion'
  const currentActivityValue = activityConnected
    ? (activity?.domain || activity?.title || activity?.url || activity?.app || 'Waiting for activity')
    : activitySources.extensionConnected && !activitySources.companionConnected
      ? 'Extension fallback seen, Companion not connected'
      : 'Waiting for Companion activity'

  return (
    <div className="screen-center" style={{ background: 'var(--bg)' }}>
      <div className="home-content" style={{ maxWidth: 720, gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="app-title" style={{ marginBottom: 4, color: 'var(--ultra-bright)' }}>Focus Apps</h1>
            <p className="app-tagline" style={{ margin: 0 }}>
              Configure the native Companion's app and website rules for focus sessions.
            </p>
          </div>
          {confirmingBack ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn)' }}>
                Unsaved changes
              </span>
              <button
                type="button"
                onClick={handleSaveAndBack}
                style={{
                  background: 'var(--good)', border: '1px solid var(--good)', borderRadius: 100,
                  padding: '8px 15px', fontSize: 12, fontWeight: 700, color: 'var(--text)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Save &amp; leave
              </button>
              <button
                type="button"
                onClick={onBack}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 100,
                  padding: '8px 15px', fontSize: 12, fontWeight: 700, color: 'var(--bad)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Discard
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleBack}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 100,
                padding: '8px 15px',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Back
            </button>
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: '12px 16px',
          boxShadow: '0 2px 20px rgba(122,152,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--ultra-bright)', fontWeight: 800 }}>
              {focusApps.length} focus apps · {distractionApps.length} blocked
            </span>
          </div>
          <label style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            color: 'var(--ultra-bright)',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
          }}>
            Focus Mode
            <button
              type="button"
              role="switch"
              aria-checked={modeEnabled}
              onClick={toggleFocusMode}
              style={{
                width: 42,
                height: 24,
                borderRadius: 100,
                border: `1px solid ${modeEnabled ? 'var(--good)' : 'var(--line-strong)'}`,
                background: modeEnabled ? 'var(--good)' : 'var(--line)',
                padding: 2,
                cursor: 'pointer',
              }}
            >
              <span style={{
                display: 'block',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'var(--surface)',
                transform: modeEnabled ? 'translateX(18px)' : 'translateX(0)',
                transition: 'transform 0.18s ease',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }} />
            </button>
          </label>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: '12px 16px',
          boxShadow: '0 2px 20px rgba(122,152,255,0.05)',
        }}>
          <CompanionStatus />

          <div style={{
            marginTop: 12,
            border: `1.5px solid ${strictMode ? 'var(--ultra)' : 'var(--line)'}`,
            background: strictMode ? 'rgba(122,152,255,0.06)' : 'var(--surface)',
            borderRadius: 12,
            padding: '13px 15px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 14,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ultra-bright)' }}>
                Strict Mode {strictMode ? '· on' : '· off'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 3 }}>
                The Companion hides every non-browser app except your focus apps and base system apps. Browsers stay open; blocked sites are handled by the native website block list.
              </div>
            </div>
            <button
              type="button"
              onClick={toggleStrictMode}
              aria-pressed={strictMode}
              style={{
                flexShrink: 0,
                width: 46,
                height: 27,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: strictMode ? 'var(--ultra)' : 'var(--line)',
                position: 'relative',
                transition: 'background 0.15s',
              }}
            >
              <span style={{
                position: 'absolute',
                top: 3,
                left: strictMode ? 22 : 3,
                width: 21,
                height: 21,
                borderRadius: '50%',
                background: 'var(--surface)',
                transition: 'left 0.15s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }} />
            </button>
          </div>

          <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
            <button
              type="button"
              onClick={handleTestBlocking}
              disabled={testBlockingActive}
              style={{
                background: 'var(--ultra)',
                border: 'none',
                borderRadius: 12,
                padding: '9px 13px',
                color: 'var(--text)',
                fontSize: 12,
                fontWeight: 900,
                cursor: testBlockingActive ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                opacity: testBlockingActive ? 0.72 : 1,
              }}
            >
              Test Blocking (60s)
            </button>
            {testFeedback && (
              <span style={{ color: 'var(--good)', fontSize: 11, fontWeight: 800 }}>
                {testFeedback}
              </span>
            )}
          </div>
        </div>

        {/* Which engine reads your goal. Switchable at any time — the app works
            the same whichever is chosen, only better or worse informed, and any
            failure falls back to the built-in profiles. */}
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 14, padding: '16px 18px', marginBottom: 16,
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
            Goal understanding
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            How your goal sentence becomes session expectations. Only that one sentence is
            ever sent — never your activity, window titles or file names.
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              { id: 'keywords', label: 'Built-in', hint: 'offline · instant' },
              { id: 'local',    label: 'Local model', hint: 'private · needs Ollama' },
              { id: 'cloud',    label: 'Claude API', hint: 'best · needs key' },
            ].map(opt => {
              const active = contract.provider === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setContract(saveContractSettings({ provider: opt.id }))}
                  style={{
                    flex: '1 1 140px',
                    padding: '9px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    background: active ? 'var(--ultra-wash)' : 'transparent',
                    border: `1px solid ${active ? 'var(--ultra-bright)' : 'var(--line)'}`,
                    color: active ? 'var(--text)' : 'var(--text-secondary)',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{opt.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {opt.hint}
                  </span>
                </button>
              )
            })}
          </div>

          {contract.provider === 'local' && (
            <input
              type="text"
              className="text-input"
              value={contract.localModel}
              onChange={e => setContract(saveContractSettings({ localModel: e.target.value }))}
              placeholder="ollama model, e.g. qwen2.5:3b"
              style={{ fontSize: 13 }}
            />
          )}

          {contract.provider === 'cloud' && (
            <>
              <input
                type="password"
                className="text-input"
                value={contract.apiKey}
                onChange={e => setContract(saveContractSettings({ apiKey: e.target.value.trim() }))}
                placeholder="Anthropic API key"
                style={{ fontSize: 13 }}
              />
              <p style={{ fontSize: 11, color: 'var(--warn)', margin: '8px 0 0', lineHeight: 1.5 }}>
                The key is kept in this app's local storage, unencrypted. Use a key scoped to
                this purpose that you can revoke.
              </p>
            </>
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: '13px 16px',
          boxShadow: '0 2px 20px rgba(122,152,255,0.05)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 800, marginBottom: 3 }}>
              Current activity from {activityRuntimeLabel}
            </div>
            <div style={{
              fontSize: 14,
              color: 'var(--ultra-bright)',
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 420,
            }}>
              {currentActivityValue}
            </div>
            {activitySources.primarySource === 'extension' && (
              <div style={{ marginTop: 4, color: 'var(--warn)', fontSize: 11, fontWeight: 750, lineHeight: 1.35 }}>
                Legacy fallback only. Start the Companion app for native tracking and blocking.
              </div>
            )}
          </div>
          <span style={{
            border: `1px solid ${activityPreview.kind === 'focus' ? 'rgba(47,227,168,0.20)' : activityPreview.kind === 'distraction' ? 'rgba(255,77,106,0.20)' : 'var(--line)'}`,
            borderRadius: 100,
            padding: '6px 11px',
            color: activityPreview.kind === 'focus' ? 'var(--good)' : activityPreview.kind === 'distraction' ? 'var(--bad)' : 'var(--text-muted)',
            background: activityPreview.kind === 'focus' ? 'rgba(47,227,168,0.10)' : activityPreview.kind === 'distraction' ? 'rgba(255,77,106,0.10)' : 'rgba(122,152,255,0.05)',
            fontSize: 12,
            fontWeight: 900,
            whiteSpace: 'nowrap',
            maxWidth: 'min(100%, 430px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {activityPreview.kind === 'focus'
              ? `${activityPreview.label} is currently detected as: focus app ✓`
              : activityPreview.kind === 'distraction'
                ? `${activityPreview.label} is currently detected as: distraction`
                : `${activityPreview.label} is currently detected as: unknown`}
          </span>
        </div>

        {configuredCount === 0 && (
          <div style={{
            background: 'var(--ultra)',
            borderRadius: 18,
            padding: '18px 20px',
            color: 'rgba(122,152,255,0.08)',
            boxShadow: '0 14px 36px rgba(122,152,255,0.18)',
          }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Start with a few presets.</p>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Add the tools you use for deep work, then add the sites that usually interrupt it.
            </p>
          </div>
        )}

        <div style={{
          display: 'grid',
          gap: 28,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 20,
          padding: 26,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
        }}>
          <AppSection
            title="Focus Apps ✓"
            subtitle="Apps and sites that support the current session."
            apps={focusApps}
            setApps={setFocusApps}
            presets={FOCUS_PRESETS}
            inputValue={focusInput}
            setInputValue={setFocusInput}
            tone="focus"
          />
          <div style={{ height: 1, background: 'rgba(122,152,255,0.08)' }} />
          <AppSection
            title="Block List ✗"
            subtitle="Apps and sites that should count as distractions."
            apps={distractionApps}
            setApps={setDistractionApps}
            presets={DISTRACTION_PRESETS}
            inputValue={distractionInput}
            setInputValue={setDistractionInput}
            tone="block"
          />
        </div>

        <button type="button" className="start-btn" onClick={handleSave}>
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  )
}
