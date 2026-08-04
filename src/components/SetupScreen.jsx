import { useState } from 'react'
import { DEVICE_ICON_MAP } from './DeviceIcons'
import { WORKSPACE_OBJECT_TYPES, defaultRoleForType } from '../lib/workspaceObjects'

// ── Device types ──────────────────────────────────────────────────────────────
export const DEVICE_TYPES = WORKSPACE_OBJECT_TYPES

// 3×3 grid
const GRID = [
  { pos: 'above-left',  label: '',      row: 0, col: 0 },
  { pos: 'above',       label: 'Above', row: 0, col: 1 },
  { pos: 'above-right', label: '',      row: 0, col: 2 },
  { pos: 'left',        label: 'Left',  row: 1, col: 0 },
  { pos: 'center',      label: 'You',   row: 1, col: 1, isYou: true },
  { pos: 'right',       label: 'Right', row: 1, col: 2 },
  { pos: 'below-left',  label: '',      row: 2, col: 0 },
  { pos: 'below',       label: 'Below', row: 2, col: 1 },
  { pos: 'below-right', label: '',      row: 2, col: 2 },
]

export const POSITION_LABELS = {
  'above-left':  'Above-Left',
  'above':       'Above',
  'above-right': 'Above-Right',
  'left':        'Left',
  'right':       'Right',
  'below-left':  'Below-Left',
  'below':       'Below',
  'below-right': 'Below-Right',
}

const navy = 'var(--ultra)'

// ── Device Picker ──────────────────────────────────────────────────────────────
function DevicePicker({ position, devices, onAdd, onRemove, onClose }) {
  const placed = devices.filter(d => d.position === position)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)',
      backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)',
        borderRadius: 24,
        padding: '32px 28px 24px',
        minWidth: 320,
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
        border: '1px solid var(--line)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 4 }}>
            {POSITION_LABELS[position]}
          </p>
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.015em' }}>Add a device</p>
        </div>

        {/* Placed devices */}
        {placed.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Placed here</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {placed.map((d, i) => {
                const dt = DEVICE_TYPES.find(t => t.id === d.type)
                const Icon = DEVICE_ICON_MAP[d.type]
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: navy + '0d', border: `1.5px solid ${navy}25`,
                    borderRadius: 12, padding: '8px 14px',
                    fontSize: 13, fontWeight: 600, color: navy,
                  }}>
                    {Icon && <Icon size={24} />}
                    <span>{dt?.label}</span>
                    <button onClick={() => onRemove(position, d.type, i)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 0 0 2px',
                    }}>×</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Device buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {DEVICE_TYPES.map(dt => {
            const Icon = DEVICE_ICON_MAP[dt.id]
            return (
              <button
                key={dt.id}
                onClick={() => { onAdd(position, dt.id); onClose() }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '16px 12px',
                  background: 'var(--surface)',
                  border: '1.5px solid var(--line)',
                  borderRadius: 16,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s, background 0.15s, transform 0.1s',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = navy; e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'scale(1.03)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.transform = 'scale(1)' }}
              >
                {Icon && <Icon size={40} />}
                <span>{dt.label}</span>
              </button>
            )
          })}
        </div>

        <button onClick={onClose} style={{
          marginTop: 16, width: '100%', padding: '11px',
          fontSize: 14, fontWeight: 600,
          background: navy, color: 'var(--text)',
          border: 'none', borderRadius: 12,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Done</button>
      </div>
    </div>
  )
}

// ── Grid Cell ──────────────────────────────────────────────────────────────────
function GridCell({ cell, devices, onClick }) {
  const [hovered, setHovered] = useState(false)

  // "You" center cell
  if (cell.isYou) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        aspectRatio: '1',
        background: `linear-gradient(135deg, ${navy} 0%, #2d4a6e 100%)`,
        borderRadius: 20,
        boxShadow: `0 8px 24px ${navy}40`,
        userSelect: 'none',
      }}>
        {/* Minimal person silhouette */}
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="12" r="7" fill="white" opacity="0.9" />
          <path d="M4 34c0-7.732 6.268-14 14-14s14 6.268 14 14" fill="white" opacity="0.6" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginTop: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>You</span>
      </div>
    )
  }

  const placed = devices.filter(d => d.position === cell.pos)
  const isEmpty = placed.length === 0
  const hasMultiple = placed.length > 1

  return (
    <div
      onClick={() => onClick(cell.pos)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        aspectRatio: '1',
        borderRadius: 20,
        border: isEmpty
          ? `2px dashed ${hovered ? 'var(--text-secondary)' : 'var(--text)'}`
          : `2px solid ${hovered ? navy : navy + '40'}`,
        background: isEmpty
          ? (hovered ? 'var(--surface)' : '#fafafa')
          : (hovered ? navy + '12' : navy + '07'),
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        position: 'relative',
        padding: 8,
        gap: 4,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered && !isEmpty ? `0 6px 16px ${navy}20` : 'none',
      }}
    >
      {isEmpty ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {cell.label && (
            <span style={{ fontSize: 10, fontWeight: 600, color: hovered ? 'var(--text-secondary)' : 'var(--line-strong)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {cell.label}
            </span>
          )}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="9" y1="3" x2="9" y2="15" stroke={hovered ? 'var(--text-secondary)' : 'var(--line-strong)'} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="3" y1="9" x2="15" y2="9" stroke={hovered ? 'var(--text-secondary)' : 'var(--line-strong)'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      ) : hasMultiple ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', alignItems: 'center' }}>
          {placed.map((d, i) => {
            const Icon = DEVICE_ICON_MAP[d.type]
            return Icon ? <Icon key={i} size={26} /> : null
          })}
          <span style={{ fontSize: 9, fontWeight: 700, color: navy, width: '100%', textAlign: 'center', letterSpacing: '0.05em' }}>
            {placed.length} DEVICES
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {(() => {
            const Icon = DEVICE_ICON_MAP[placed[0].type]
            return Icon ? <Icon size={44} /> : null
          })()}
          <span style={{ fontSize: 9, fontWeight: 700, color: navy, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {DEVICE_TYPES.find(t => t.id === placed[0].type)?.label}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Summary chips ──────────────────────────────────────────────────────────────
function DeviceSummary({ devices }) {
  if (!devices.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
      {devices.map((d, i) => {
        const dt = DEVICE_TYPES.find(t => t.id === d.type)
        const Icon = DEVICE_ICON_MAP[d.type]
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#f1f5f9', borderRadius: 100,
            padding: '5px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
          }}>
            {Icon && <Icon size={18} />}
            <span>{dt?.label}</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>·</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{POSITION_LABELS[d.position]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function SetupScreen({ devices, setDevices, onContinue }) {
  const [pickerPos, setPickerPos] = useState(null)

  const handleAdd = (position, type) => {
    setDevices(prev => [...prev, { position, type, role: defaultRoleForType(type) }])
  }

  const handleRemove = (position, type, globalIdx) => {
    setDevices(prev => {
      const next = [...prev]
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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px',
      background: 'var(--surface)',
    }}>
      <div style={{ width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.028em', color: 'var(--text)', marginBottom: 10 }}>
            Your Setup
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Place your devices so we know where everything is.<br />
            Better setup = more accurate focus tracking.
          </p>
        </div>

        {/* 3D-perspective grid */}
        <div style={{
          perspective: '900px',
          perspectiveOrigin: '50% 120%',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            transform: 'rotateX(10deg)',
            transformStyle: 'preserve-3d',
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
        </div>

        {/* Direction labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: -20, padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Left</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Right</span>
        </div>

        {/* Device summary */}
        {devices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <DeviceSummary devices={devices} />
            <button
              onClick={() => setDevices([])}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'inherit' }}
            >
              Clear all
            </button>
          </div>
        )}

        {/* CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onContinue}
            style={{
              width: '100%', padding: '15px',
              fontSize: 16, fontWeight: 600,
              background: navy, color: 'var(--text)',
              border: 'none', borderRadius: 14,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
          >
            {devices.length > 0 ? 'Save & Continue' : 'Skip for now →'}
          </button>
          {!devices.length && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#c4c9d4' }}>
              You can always update this from the home screen
            </p>
          )}
        </div>
      </div>

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
