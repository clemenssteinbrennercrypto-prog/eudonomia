import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getLastActivity,
  isActivityConnected,
  startActivityUpdates,
  stopActivityUpdates,
} from '../lib/activityReceiver'
import {
  fetchCompanionDebug,
  fetchNativeCameraStatus,
  installCompanionHelper,
  listenNativeCameraLandmarks,
  listenNativeCameraStatus,
  pushCompanionSession,
  startNativeCameraPrototype,
  stopNativeCameraPrototype,
  setCloudApiKey,
  deleteCloudApiKey,
  hasCloudApiKey,
} from '../lib/nativeCompanion'
import { getDomainsFromAppPreset } from '../lib/focusAppsConfig'
import { CLOUD_GOAL_MAX_CHARS } from '../lib/intentContract'
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
  loadContractSettings,
  saveContractSettings,
  loadFocusModeEnabled,
  loadProtectionSetups,
  saveFocusModeEnabled,
  saveProtectionSetups,
} from '../lib/storage'
import ConfirmDialog from './ConfirmDialog'

const FOCUS_PRESETS = ['VS Code', 'Figma', 'Terminal', 'Notion', 'Safari', 'Chrome']
const DISTRACTION_PRESETS = ['YouTube', 'Instagram', 'Twitter/X', 'TikTok', 'Reddit', 'Netflix']
const SHOW_NATIVE_CAMERA_DIAGNOSTICS = import.meta.env.DEV ||
  import.meta.env.VITE_EUDONOMIA_BUILD_CHANNEL === 'test'

export function CloudPrivacyNotice() {
  return (
    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
      How your session plan becomes session expectations. With Cloud, only the text you
      typed into &quot;Definition of plan&quot; is sent to Anthropic, cut to the first{' '}
      {CLOUD_GOAL_MAX_CHARS} characters — never the session name, tags, activity, window
      titles or file names, and never anything after the session. Leave that field empty
      and nothing is sent: the built-in profiles answer instead.
    </p>
  )
}

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
        ? `Enable Eudaimonai Companion Automation access for ${permissionMissing} in System Settings.`
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
            Enter your Mac password <b>once</b> to let Eudaimonai block distraction sites silently — no password on every session. It installs a small helper that only edits your block list.
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
          Native V2 is the measurement source for every new session. Historical V1 sessions
          remain readable, but daily scores, trends and patterns never mix the two generations.
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
  const [activity, setActivity] = useState(() => getLastActivity())
  const [activityConnected, setActivityConnected] = useState(() => isActivityConnected())
  const [testFeedback, setTestFeedback] = useState('')
  const [testBlockingActive, setTestBlockingActive] = useState(false)
  const [contract, setContract] = useState(loadContractSettings)
  const [cloudKey, setCloudKey] = useState('')
  const [cloudKeyStatus, setCloudKeyStatus] = useState('pending')
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
  const readiness = useMemo(
    () => getProtectionReadiness({ enabled: modeEnabled, setup: normalizeProtectionSetup(activeSetup, activeSetup.id), nativeStatus: companionStatus }),
    [modeEnabled, activeSetup, companionStatus],
  )
  const rulesConfigured = strictMode || distractionApps.length > 0
  const protectionReady = readiness.state === 'ready'
  const nameIssue = protectionSetupNameIssue(protectionState.setups, activeSetup.id)
  const invalidNameSetup = firstProtectionSetupWithNameIssue(protectionState.setups)
  const activityPreview = useMemo(
    () => classifyCurrentActivity(activity, focusApps, distractionApps, activityConnected),
    [activity, focusApps, distractionApps, activityConnected]
  )

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

  useEffect(() => {
    startActivityUpdates((nextActivity) => {
      setActivity(nextActivity)
      setActivityConnected(isActivityConnected())
    })
    const heartbeat = setInterval(() => {
      setActivity(getLastActivity())
      setActivityConnected(isActivityConnected())
    }, 1000)
    return () => {
      clearInterval(heartbeat)
      stopActivityUpdates()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    hasCloudApiKey().then(configured => {
      if (!cancelled) setCloudKeyStatus(configured === null ? 'error' : configured ? 'configured' : 'not-configured')
    })
    return () => { cancelled = true }
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

  const toggleStrictMode = () => updateActiveSetup({ strictMode: !strictMode })

  const handleSaveCloudKey = async () => {
    const key = cloudKey.trim()
    if (!key) {
      setCloudKeyStatus('error')
      return
    }
    setCloudKeyStatus('saving')
    const ok = await setCloudApiKey(key)
    if (ok) setCloudKey('')
    setCloudKeyStatus(ok ? 'configured' : 'error')
  }

  const handleRemoveCloudKey = async () => {
    setCloudKeyStatus('removing')
    const ok = await deleteCloudApiKey()
    if (ok) setCloudKey('')
    setCloudKeyStatus(ok ? 'not-configured' : 'error')
  }

  const cloudKeyBusy = cloudKeyStatus === 'saving' || cloudKeyStatus === 'removing' || cloudKeyStatus === 'pending'
  const saveKeyDisabled = !cloudKey.trim() || cloudKeyBusy
  const removeKeyDisabled = cloudKeyBusy || cloudKeyStatus === 'not-configured' || cloudKeyStatus === 'error'

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

  const activityRuntimeLabel = 'Native Companion'
  const currentActivityValue = activityConnected
    ? (activity?.domain || activity?.title || activity?.url || activity?.app || 'Waiting for activity')
    : 'Waiting for Companion activity'

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
                    helper: 'Install the website blocking helper under Advanced so websites can be blocked.',
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

          <footer className="protection-save-row">
            <span>{invalidNameSetup && hasUnsavedChanges ? 'Name every setup before saving' : hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}</span>
            <button type="button" disabled={(!hasUnsavedChanges && !saved) || Boolean(invalidNameSetup)} onClick={handleSave}>
              {saved ? 'Saved' : 'Save setup'}
            </button>
          </footer>
        </section>
      </div>

      <details className="protection-advanced">
        <summary>
          <span>Advanced</span>
          <small>Companion status, blocking test and goal understanding</small>
        </summary>
        <div className="protection-advanced-content">
          <CompanionStatus />

          <section className="protection-advanced-section">
            <div className="protection-advanced-row">
              <div>
                <strong>Blocking test</strong>
                <p>Temporarily enforce the current draft for 60 seconds.</p>
              </div>
              <button type="button" onClick={handleTestBlocking} disabled={testBlockingActive}>
                {testBlockingActive ? 'Test active' : 'Test for 60s'}
              </button>
            </div>
            {testFeedback && <span className="protection-test-feedback">{testFeedback}</span>}
          </section>

          <section className="protection-advanced-section">
            <div className="protection-activity-preview">
              <div>
                <span>Current activity from {activityRuntimeLabel}</span>
                <strong>{currentActivityValue}</strong>
              </div>
              <em className={`is-${activityPreview.kind}`}>
                {activityPreview.kind === 'focus'
                  ? `${activityPreview.label} · allowed`
                  : activityPreview.kind === 'distraction'
                    ? `${activityPreview.label} · unavailable`
                    : `${activityPreview.label} · not classified`}
              </em>
            </div>
          </section>

          <section className="protection-advanced-section">
            <strong>Goal understanding</strong>
            <CloudPrivacyNotice />
            <div className="protection-provider-options">
              {[
                { id: 'keywords', label: 'Built-in', hint: 'offline · instant' },
                { id: 'local', label: 'Local model', hint: 'private · needs Ollama' },
                { id: 'cloud', label: 'Claude API', hint: 'best · needs key' },
              ].map(opt => {
                const active = contract.provider === opt.id
                return (
                  <button key={opt.id} type="button" className={active ? 'is-active' : ''} onClick={() => setContract(saveContractSettings({ provider: opt.id }))}>
                    <strong>{opt.label}</strong>
                    <span>{opt.hint}</span>
                  </button>
                )
              })}
            </div>

            {contract.provider === 'local' && (
              <input type="text" className="text-input" value={contract.localModel} onChange={event => setContract(saveContractSettings({ localModel: event.target.value }))} placeholder="ollama model, e.g. qwen2.5:3b" />
            )}

            {contract.provider === 'cloud' && (
              <>
                <input
                  type="password"
                  className="text-input"
                  value={cloudKey}
                  onChange={event => {
                    setCloudKey(event.target.value)
                    setCloudKeyStatus('not-saved')
                  }}
                  placeholder="Anthropic API key"
                />
                <div className="protection-key-actions">
                  <button type="button" onClick={handleSaveCloudKey} disabled={saveKeyDisabled}>Save key</button>
                  <button type="button" onClick={handleRemoveCloudKey} disabled={removeKeyDisabled}>Remove key</button>
                  <span role="status" aria-live="polite">
                    {({ pending: 'Checking Keychain…', saving: 'Saving…', removing: 'Removing…', configured: 'Keychain key configured', 'not-configured': 'No Keychain key configured', 'not-saved': 'Unsaved key', error: 'Keychain unavailable' })[cloudKeyStatus]}
                  </span>
                </div>
                <p className="protection-key-note">The key stays in your macOS Keychain and is used only for goal understanding.</p>
              </>
            )}
          </section>

          {SHOW_NATIVE_CAMERA_DIAGNOSTICS && <NativeCameraDiagnostics />}
        </div>
      </details>

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
