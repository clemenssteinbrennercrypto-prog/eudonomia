import { useEffect, useMemo, useRef, useState } from 'react'
import ExtensionSetup from './ExtensionSetup'
import {
  fetchCompanionDebug,
  getLastActivity,
  installCompanionHelper,
  isExtensionConnected,
  pushCompanionSession,
  startActivityPolling,
  stopActivityPolling,
} from '../lib/activityReceiver'
import { getDomainsFromAppPreset } from '../lib/focusAppsConfig'
import { loadFocusAppsConfig, loadFocusModeEnabled, saveFocusAppsConfig, saveFocusModeEnabled } from '../lib/storage'

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

function AppChip({ app, tone, onRemove }) {
  const colors = tone === 'focus'
    ? { bg: '#f7fbf8', border: '#cfe9d7', text: '#1f5132', xBg: '#e8f5ec', xText: '#2f6f46' }
    : { bg: '#fff8f7', border: '#f2d2ce', text: '#7a2f28', xBg: '#fde9e7', xText: '#9a3a32' }

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
          <h2 style={{ margin: 0, color: '#1a2e4a', fontSize: 20, fontWeight: 800, letterSpacing: 0 }}>{title}</h2>
          <p style={{ margin: '4px 0 0', color: '#8a8177', fontSize: 13, lineHeight: 1.45 }}>{subtitle}</p>
        </div>
        <span style={{
          border: '1px solid #E8E3DA',
          borderRadius: 100,
          padding: '4px 10px',
          color: '#6b7280',
          fontSize: 12,
          fontWeight: 700,
          background: '#fff',
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
            background: '#1a2e4a',
            border: 'none',
            borderRadius: 13,
            padding: '0 16px',
            color: '#fff',
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
            border: '1.5px dashed #ded8cf',
            borderRadius: 14,
            padding: '14px 16px',
            color: '#9a9288',
            fontSize: 13,
            lineHeight: 1.45,
            background: 'rgba(255,255,255,0.55)',
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
              background: '#fff',
              border: '1px solid #d8d2c8',
              borderRadius: 100,
              padding: '6px 12px',
              color: '#5f6d7f',
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

  const tone = !connected ? 'red' : debug?.sessionActive ? 'green' : 'yellow'
  const colors = {
    green: { border: '#bbf7d0', bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
    yellow: { border: '#fde68a', bg: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
    red: { border: '#fecaca', bg: '#fef2f2', text: '#991b1b', dot: '#ef4444' },
  }[tone]

  const label = !connected
    ? '✗ Companion not found — blocking disabled'
    : debug?.sessionActive
      ? `✓ Companion connected — blocking active (${debug.blockedAppsCount || 0} apps, ${debug.blockedDomainsCount || 0} domains)`
      : '⚠ Companion connected — no active session'

  const lastActivity = debug?.lastActivity
  const activityLabel = lastActivity?.domain || lastActivity?.app || null

  // Website blocking runs system-wide via /etc/hosts and needs an admin
  // password once per session. Surface its real state so a dismissed prompt
  // (hostBlockError "cancelled") doesn't look like silent success.
  const hostCancelled = debug?.hostBlockError === 'cancelled'
  const hostFailed = debug?.hostBlockError && !hostCancelled
  const websitesBlocked = debug?.hostBlockActive
  const helperInstalled = debug?.helperInstalled

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        width: 'fit-content',
        maxWidth: '100%',
        border: `1px solid ${colors.border}`,
        borderRadius: 100,
        padding: '6px 11px',
        color: colors.text,
        background: colors.bg,
        fontSize: 12,
        fontWeight: 900,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: colors.dot,
          boxShadow: `0 0 0 2px ${colors.dot}28`,
          flexShrink: 0,
        }} />
        {label}
      </span>

      {connected && !helperInstalled && (
        <div style={{
          border: '1px solid #93c5fd',
          background: '#eff6ff',
          color: '#1e3a8a',
          borderRadius: 12,
          padding: '12px 14px',
          display: 'grid',
          gap: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>⚡ Frictionless blocking (one-time setup)</div>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.5, color: '#1d4ed8' }}>
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
              background: installing ? '#93c5fd' : '#2563eb',
              color: '#fff',
            }}
          >
            {installing ? 'Waiting for password…' : 'Enable — enter password once'}
          </button>
          {installError && (
            <div style={{ fontSize: 12, fontWeight: 800, color: '#991b1b' }}>⚠ {installError}</div>
          )}
        </div>
      )}

      {connected && helperInstalled && (
        <div style={{ color: '#166534', fontSize: 11, fontWeight: 800 }}>
          ⚡ Silent blocking enabled — no password needed per session
        </div>
      )}

      {connected && debug?.sessionActive && websitesBlocked && (
        <div style={{
          border: '1px solid #bbf7d0',
          background: '#f0fdf4',
          color: '#166534',
          borderRadius: 12,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1.45,
        }}>
          🌐 Websites blocked system-wide (all browsers) via /etc/hosts
        </div>
      )}

      {hostCancelled && (
        <div style={{
          border: '1px solid #fbbf24',
          background: '#fffbeb',
          color: '#92400e',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1.45,
        }}>
          ⚠ Website blocking is OFF — you dismissed the admin password prompt. Restart the session and enter your Mac password to block sites across all browsers. (App blocking still works.)
        </div>
      )}

      {hostFailed && (
        <div style={{
          border: '1px solid #fecaca',
          background: '#fef2f2',
          color: '#991b1b',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1.45,
        }}>
          ✗ Website blocking failed: {debug.hostBlockError}
        </div>
      )}

      {debug?.permissionMissing && (
        <div style={{
          border: '1px solid #fbbf24',
          background: '#fffbeb',
          color: '#92400e',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1.45,
        }}>
          ⚠ Missing Automation permission for {debug.permissionMissing}. Go to: System Settings → Privacy & Security → Automation → enable Eudonomia Companion for {debug.permissionMissing}
        </div>
      )}

      {connected && (
        <div style={{ color: '#8a8177', fontSize: 11, fontWeight: 700, lineHeight: 1.4 }}>
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
  const [localFocusModeEnabled, setLocalFocusModeEnabled] = useState(() => loadFocusModeEnabled())
  const [activity, setActivity] = useState(() => getLastActivity())
  const [extensionConnected, setExtensionConnected] = useState(() => isExtensionConnected())
  const [testFeedback, setTestFeedback] = useState('')
  const testTimerRef = useRef(null)

  const configuredCount = focusApps.length + distractionApps.length
  const modeEnabled = focusModeEnabled ?? localFocusModeEnabled
  const activityPreview = useMemo(
    () => classifyCurrentActivity(activity, focusApps, distractionApps, extensionConnected),
    [activity, focusApps, distractionApps, extensionConnected]
  )

  useEffect(() => {
    startActivityPolling((nextActivity) => {
      setActivity(nextActivity)
      setExtensionConnected(isExtensionConnected())
    })
    const heartbeat = setInterval(() => {
      setActivity(getLastActivity())
      setExtensionConnected(isExtensionConnected())
    }, 1000)
    return () => {
      clearInterval(heartbeat)
      stopActivityPolling()
    }
  }, [])

  useEffect(() => () => {
    if (testTimerRef.current) clearTimeout(testTimerRef.current)
  }, [])

  const toggleFocusMode = () => {
    const next = !modeEnabled
    if (setFocusModeEnabled) setFocusModeEnabled(next)
    setLocalFocusModeEnabled(saveFocusModeEnabled(next))
  }

  const handleSave = () => {
    const next = saveFocusAppsConfig({ focusApps, distractionApps })
    setFocusApps(next.focusApps)
    setDistractionApps(next.distractionApps)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const handleTestBlocking = () => {
    if (testTimerRef.current) clearTimeout(testTimerRef.current)

    const blockedApps = distractionApps
    const blockedDomains = [...new Set(domainsFor(distractionApps))]
    pushCompanionSession({
      active: true,
      endTs: Date.now() + 60_000,
      blockedApps,
      blockedDomains,
    })
    setTestFeedback('Test session active for 60s')

    testTimerRef.current = setTimeout(() => {
      pushCompanionSession({
        active: false,
        endTs: 0,
        blockedApps: [],
        blockedDomains: [],
      })
      setTestFeedback('')
      testTimerRef.current = null
    }, 60_000)
  }

  return (
    <div className="screen-center" style={{ background: '#F5F4F0' }}>
      <div className="home-content" style={{ maxWidth: 720, gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="app-title" style={{ marginBottom: 4, color: '#1a2e4a' }}>Focus Apps</h1>
            <p className="app-tagline" style={{ margin: 0 }}>
              Choose what counts as work and what should pull your score down.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: '#fff',
              border: '1px solid #E8E3DA',
              borderRadius: 100,
              padding: '8px 15px',
              fontSize: 12,
              fontWeight: 700,
              color: '#6b7280',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Back
          </button>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          background: '#fff',
          border: '1px solid #E8E3DA',
          borderRadius: 16,
          padding: '12px 16px',
          boxShadow: '0 2px 20px rgba(26,46,74,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              border: '1px solid #E8E3DA',
              borderRadius: 100,
              padding: '5px 10px',
              color: extensionConnected ? '#166534' : '#92400e',
              background: extensionConnected ? '#f0fdf4' : '#fffbeb',
              fontSize: 12,
              fontWeight: 800,
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: extensionConnected ? '#22c55e' : '#f59e0b',
                boxShadow: extensionConnected ? '0 0 0 2px #22c55e28' : '0 0 0 2px #f59e0b28',
              }} />
              {extensionConnected ? 'Extension connected' : 'Extension not detected'}
            </span>
            {!extensionConnected && (
              <a
                href="#extension-setup"
                style={{ color: '#1a2e4a', fontSize: 12, fontWeight: 800, textDecoration: 'underline' }}
              >
                Install instructions
              </a>
            )}
            <span style={{ fontSize: 13, color: '#1a2e4a', fontWeight: 800 }}>
              {focusApps.length} focus apps · {distractionApps.length} blocked
            </span>
          </div>
          <label style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            color: '#1a2e4a',
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
                border: `1px solid ${modeEnabled ? '#22c55e' : '#d1d5db'}`,
                background: modeEnabled ? '#22c55e' : '#e5e7eb',
                padding: 2,
                cursor: 'pointer',
              }}
            >
              <span style={{
                display: 'block',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#fff',
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
          background: '#fff',
          border: '1px solid #E8E3DA',
          borderRadius: 16,
          padding: '12px 16px',
          boxShadow: '0 2px 20px rgba(26,46,74,0.05)',
        }}>
          <CompanionStatus />
          <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
            <button
              type="button"
              onClick={handleTestBlocking}
              style={{
                background: '#1a2e4a',
                border: 'none',
                borderRadius: 12,
                padding: '9px 13px',
                color: '#fff',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              Test Blocking (60s)
            </button>
            {testFeedback && (
              <span style={{ color: '#166534', fontSize: 11, fontWeight: 800 }}>
                {testFeedback}
              </span>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          background: '#fff',
          border: '1px solid #E8E3DA',
          borderRadius: 16,
          padding: '13px 16px',
          boxShadow: '0 2px 20px rgba(26,46,74,0.05)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#8a8177', fontWeight: 800, marginBottom: 3 }}>
              Current active site
            </div>
            <div style={{
              fontSize: 14,
              color: '#1a2e4a',
              fontWeight: 800,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 420,
            }}>
              {extensionConnected ? (activity?.domain || activity?.title || activity?.url || 'Waiting for browser activity') : 'Waiting for extension'}
            </div>
          </div>
          <span style={{
            border: `1px solid ${activityPreview.kind === 'focus' ? '#bbf7d0' : activityPreview.kind === 'distraction' ? '#fecaca' : '#e5e7eb'}`,
            borderRadius: 100,
            padding: '6px 11px',
            color: activityPreview.kind === 'focus' ? '#166534' : activityPreview.kind === 'distraction' ? '#991b1b' : '#6b7280',
            background: activityPreview.kind === 'focus' ? '#f0fdf4' : activityPreview.kind === 'distraction' ? '#fef2f2' : '#f9fafb',
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

        {!extensionConnected && <ExtensionSetup />}

        {configuredCount === 0 && (
          <div style={{
            background: '#1a2e4a',
            borderRadius: 18,
            padding: '18px 20px',
            color: '#eef4fb',
            boxShadow: '0 14px 36px rgba(26,46,74,0.18)',
          }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Start with a few presets.</p>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: '#cbd5e1', lineHeight: 1.45 }}>
              Add the tools you use for deep work, then add the sites that usually interrupt it.
            </p>
          </div>
        )}

        <div style={{
          display: 'grid',
          gap: 28,
          background: '#F5F4F0',
          border: '1px solid #E8E3DA',
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
          <div style={{ height: 1, background: '#E8E3DA' }} />
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
