import { useMemo, useState } from 'react'
import { loadFocusAppsConfig, saveFocusAppsConfig } from '../lib/storage'

const FOCUS_PRESETS = ['VS Code', 'Xcode', 'Terminal', 'Figma', 'Notion', 'Linear', 'Cursor', 'Zed']
const DISTRACTION_PRESETS = ['YouTube', 'Instagram', 'Twitter/X', 'TikTok', 'Reddit', 'Netflix', 'WhatsApp', 'Telegram']

function addUnique(list, value) {
  const app = value.trim()
  if (!app) return list
  if (list.some(item => item.toLowerCase() === app.toLowerCase())) return list
  return [...list, app]
}

function AppSection({ title, apps, setApps, presets, inputValue, setInputValue }) {
  const availablePresets = useMemo(
    () => presets.filter(preset => !apps.some(app => app.toLowerCase() === preset.toLowerCase())),
    [apps, presets]
  )

  const addApp = (value = inputValue) => {
    setApps(prev => addUnique(prev, value))
    setInputValue('')
  }

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, color: '#1a2e4a', fontSize: 18, fontWeight: 700 }}>{title}</h2>
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
          placeholder="App name"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => addApp()}
          style={{
            background: '#1a2e4a',
            border: 'none',
            borderRadius: 10,
            padding: '0 16px',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          Add app
        </button>
      </div>

      {apps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {apps.map(app => (
            <span
              key={app}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#fff',
                border: '1.5px solid #E8E3DA',
                borderRadius: 100,
                padding: '6px 8px 6px 12px',
                color: '#1f2937',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {app}
              <button
                type="button"
                onClick={() => setApps(prev => prev.filter(item => item !== app))}
                aria-label={`Remove ${app}`}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#f3f4f6',
                  color: '#6b7280',
                  cursor: 'pointer',
                  lineHeight: 1,
                  fontSize: 14,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {availablePresets.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => addApp(preset)}
            style={{
              background: 'transparent',
              border: '1px solid #d8d2c8',
              borderRadius: 100,
              padding: '5px 11px',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {preset}
          </button>
        ))}
      </div>
    </section>
  )
}

export default function FocusAppsScreen({ onBack }) {
  const initial = useMemo(() => loadFocusAppsConfig(), [])
  const [focusApps, setFocusApps] = useState(initial.focusApps)
  const [distractionApps, setDistractionApps] = useState(initial.distractionApps)
  const [focusInput, setFocusInput] = useState('')
  const [distractionInput, setDistractionInput] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    const next = saveFocusAppsConfig({ focusApps, distractionApps })
    setFocusApps(next.focusApps)
    setDistractionApps(next.distractionApps)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="screen-center">
      <div className="home-content" style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            <h1 className="app-title" style={{ marginBottom: 4 }}>Focus Apps</h1>
            <p className="app-tagline" style={{ margin: 0 }}>Tell Eudaimonia which apps support your work.</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: '1px solid #e5e7eb',
              borderRadius: 100,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: '#6b7280',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Back
          </button>
        </div>

        <div style={{
          display: 'grid',
          gap: 26,
          background: '#F5F4F0',
          border: '1px solid #E8E3DA',
          borderRadius: 16,
          padding: 24,
        }}>
          <AppSection
            title="Focus Apps"
            apps={focusApps}
            setApps={setFocusApps}
            presets={FOCUS_PRESETS}
            inputValue={focusInput}
            setInputValue={setFocusInput}
          />
          <div style={{ height: 1, background: '#E8E3DA' }} />
          <AppSection
            title="Distraction Apps"
            apps={distractionApps}
            setApps={setDistractionApps}
            presets={DISTRACTION_PRESETS}
            inputValue={distractionInput}
            setInputValue={setDistractionInput}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12 }}>
          <span style={{ fontSize: 12, color: saved ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
            {saved ? 'Saved' : `${focusApps.length} focus apps · ${distractionApps.length} distraction apps`}
          </span>
          <button type="button" className="start-btn" onClick={handleSave} style={{ width: 'auto', minWidth: 130 }}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
