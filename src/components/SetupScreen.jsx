import { useState } from 'react'

// ── Device Setup Screen ───────────────────────────────────────────────────────
// Visual workspace configurator: place devices around "You" on a 3×3 grid.
// Produces a `devices` array: [{ type, position }]

const DEVICE_TYPES = [
  { id: 'monitor', label: 'Monitor',  icon: '🖥️'  },
  { id: 'laptop',  label: 'Laptop',   icon: '💻'  },
  { id: 'ipad',    label: 'iPad',     icon: '🪟'  },
  { id: 'phone',   label: 'Phone',    icon: '📱'  },
  { id: 'camera',  label: 'Camera',   icon: '📷'  },
]

// 3×3 grid positions (row, col) → position key + label
const GRID = [
  { pos: 'above-left',  label: '',         row: 0, col: 0 },
  { pos: 'above',       label: 'Above',    row: 0, col: 1 },
  { pos: 'above-right', label: '',         row: 0, col: 2 },
  { pos: 'left',        label: 'Left',     row: 1, col: 0 },
  { pos: 'center',      label: 'You',      row: 1, col: 1, isYou: true },
  { pos: 'right',       label: 'Right',    row: 1, col: 2 },
  { pos: 'below-left',  label: '',         row: 2, col: 0 },
  { pos: 'below',       label: 'Below',    row: 2, col: 1 },
  { pos: 'below-right', label: '',         row: 2, col: 2 },
]

const POSITION_LABELS = {
  'above-left':  'Above-Left',
  'above':       'Above',
  'above-right': 'Above-Right',
  'left':        'Left',
  'right':       'Right',
  'below-left':  'Below-Left',
  'below':       'Below',
  'below-right': 'Below-Right',
}

const navy = '#1a2e4a'

// ── Device picker popover ─────────────────────────────────────────────────────
function DevicePicker({ position, devices, onAdd, onRemove, onClose }) {
  const placed = devices.filter(d => d.position === position)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.25)',
      backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: '#fff',
        borderRadius: 20,
        padding: '28px 28px 24px',
        minWidth: 300,
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        border: '1px solid #e5e7eb',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            {POSITION_LABELS[position]}
          </p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Add a device</p>
        </div>

        {/* Already placed */}
        {placed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Placed here
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {placed.map((d, i) => {
                const dt = DEVICE_TYPES.find(t => t.id === d.type)
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: navy + '10', border: `1.5px solid ${navy}30`,
                    borderRadius: 100, padding: '5px 12px',
                    fontSize: 13, fontWeight: 500, color: navy,
                  }}>
                    <span>{dt?.icon}</span>
                    <span>{dt?.label}</span>
                    <button
                      onClick={() => onRemove(d.position, d.type, i)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 0 0 4px',
                      }}
                    >×</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add device buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {DEVICE_TYPES.map(dt => (
            <button
              key={dt.id}
              onClick={() => { onAdd(position, dt.id); onClose() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px',
                background: '#f9fafb',
                border: '1.5px solid #e5e7eb',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s, background 0.15s',
                fontSize: 14,
                fontWeight: 500,
                color: '#111827',
              }}
            >
              <span style={{ fontSize: 20 }}>{dt.icon}</span>
              <span>{dt.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%',
            padding: '10px', fontSize: 14, fontWeight: 500,
            background: 'none', border: '1px solid #e5e7eb',
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
            color: '#6b7280',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ── Grid cell ─────────────────────────────────────────────────────────────────
function GridCell({ cell, devices, onClick }) {
  if (cell.isYou) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: navy, borderRadius: 16,
        aspectRatio: '1',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 28 }}>🧑‍💻</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginTop: 4, letterSpacing: '0.05em' }}>YOU</span>
      </div>
    )
  }

  const placed = devices.filter(d => d.position === cell.pos)
  const isEmpty = placed.length === 0

  return (
    <div
      onClick={() => onClick(cell.pos)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        aspectRatio: '1',
        borderRadius: 16,
        border: isEmpty ? '2px dashed #e5e7eb' : `2px solid ${navy}40`,
        background: isEmpty ? '#fafafa' : navy + '08',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        position: 'relative',
        gap: 3,
        padding: 6,
        minHeight: 80,
      }}
    >
      {isEmpty ? (
        <>
          {cell.label && (
            <span style={{ fontSize: 11, color: '#d1d5db', fontWeight: 500 }}>{cell.label}</span>
          )}
          <span style={{ fontSize: 20, color: '#d1d5db' }}>+</span>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
            {placed.map((d, i) => {
              const dt = DEVICE_TYPES.find(t => t.id === d.type)
              return <span key={i} style={{ fontSize: placed.length > 2 ? 16 : 22 }}>{dt?.icon}</span>
            })}
          </div>
          {placed.length === 1 && (
            <span style={{ fontSize: 10, color: navy, fontWeight: 600 }}>
              {DEVICE_TYPES.find(t => t.id === placed[0].type)?.label}
            </span>
          )}
          {placed.length > 1 && (
            <span style={{ fontSize: 10, color: navy, fontWeight: 600 }}>{placed.length} devices</span>
          )}
        </>
      )}
    </div>
  )
}

// ── Device legend / summary ───────────────────────────────────────────────────
function DeviceSummary({ devices }) {
  if (devices.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
    }}>
      {devices.map((d, i) => {
        const dt = DEVICE_TYPES.find(t => t.id === d.type)
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: '#f3f4f6', borderRadius: 100,
            padding: '4px 10px', fontSize: 12, fontWeight: 500, color: '#374151',
          }}>
            <span>{dt?.icon}</span>
            <span>{dt?.label}</span>
            <span style={{ color: '#9ca3af' }}>·</span>
            <span style={{ color: '#6b7280' }}>{POSITION_LABELS[d.position]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SetupScreen({ devices, setDevices, onContinue }) {
  const [pickerPos, setPickerPos] = useState(null)

  const handleAdd = (position, type) => {
    setDevices(prev => [...prev, { position, type }])
  }

  // Remove by index within that position's devices
  const handleRemove = (position, type, globalIdx) => {
    setDevices(prev => {
      const next = [...prev]
      // Find actual index in the global array
      let count = 0
      for (let i = 0; i < next.length; i++) {
        if (next[i].position === position) {
          if (count === globalIdx) { next.splice(i, 1); break }
          count++
        }
      }
      return next
    })
  }

  const handleClearAll = () => setDevices([])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px',
      background: '#fff',
    }}>
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: '#111827', marginBottom: 8 }}>
            Your Setup
          </h1>
          <p style={{ fontSize: 15, color: '#9ca3af', lineHeight: 1.5 }}>
            Place your devices so we know where everything is.<br/>
            This makes the focus tracking much more accurate.
          </p>
        </div>

        {/* 3×3 Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
        }}>
          {GRID.map(cell => (
            <GridCell
              key={cell.pos}
              cell={cell}
              devices={devices}
              onClick={setPickerPos}
            />
          ))}
        </div>

        {/* Device summary */}
        {devices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <DeviceSummary devices={devices} />
            <button
              onClick={handleClearAll}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: '#9ca3af', fontFamily: 'inherit',
              }}
            >
              Clear all
            </button>
          </div>
        )}

        {/* Skip / Continue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onContinue}
            style={{
              width: '100%', padding: '15px',
              fontSize: 16, fontWeight: 600,
              background: navy, color: '#fff',
              border: 'none', borderRadius: 14,
              cursor: 'pointer', fontFamily: 'inherit',
              opacity: 1,
              transition: 'opacity 0.15s',
            }}
          >
            {devices.length > 0 ? 'Save & Continue' : 'Skip for now →'}
          </button>
          {devices.length === 0 && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#c4c9d4' }}>
              You can always update this from the home screen
            </p>
          )}
        </div>

      </div>

      {/* Device picker overlay */}
      {pickerPos && (
        <DevicePicker
          position={pickerPos}
          devices={devices}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onClose={() => setPickerPos(null)}
        />
      )}
    </div>
  )
}

// Named export for re-use
export { DEVICE_TYPES, POSITION_LABELS }
