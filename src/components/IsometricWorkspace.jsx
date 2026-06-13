import { useState } from 'react'

// ── Perspective Desk View ──────────────────────────────────────────────────────
// Single vanishing point at top-center.
// "You" are at the bottom looking at your desk from a seated position.
// The desk fills most of the canvas, wider at bottom (near) narrower at top (far).

const VP = { x: 320, y: 60 }   // vanishing point
const W  = 640
const H  = 420

// Map desk coordinates (col 0-1, row 0-1) to SVG canvas
// row=0 = far edge (back of desk), row=1 = near edge (front, closest to you)
// col=0 = left edge, col=1 = right edge
const DESK_NEAR_Y = 390   // y of front edge
const DESK_FAR_Y  = 130   // y of back edge
const DESK_NEAR_L = 40    // x of front-left corner
const DESK_NEAR_R = 600   // x of front-right corner
const DESK_FAR_L  = 155   // x of back-left corner
const DESK_FAR_R  = 485   // x of back-right corner

function deskX(col, row) {
  // left edge at col=0, right at col=1
  const nearX = DESK_NEAR_L + col * (DESK_NEAR_R - DESK_NEAR_L)
  const farX  = DESK_FAR_L  + col * (DESK_FAR_R  - DESK_FAR_L)
  return nearX + row * (farX - nearX)
}
function deskY(row) {
  return DESK_NEAR_Y + row * (DESK_FAR_Y - DESK_NEAR_Y)
}
function dp(col, row) { return `${deskX(col, row).toFixed(1)},${deskY(row).toFixed(1)}` }

// Scale factor based on row depth (near = big, far = small)
function depthScale(row) {
  return 0.45 + (1 - row) * 0.55   // near row=0→1.0, far row=1→0.45
}

// Center point of a zone on desk (in SVG coords)
function zoneSVG(col, row) {
  return { x: deskX(col, row), y: deskY(row) }
}

// ── Zone definitions ──────────────────────────────────────────────────────────
// Layout: 3 columns × 3 rows on desk
// row: 0=near/front ... 1=far/back   (inverted: row 0 is near you)
export const ZONES = [
  // Back row (furthest from you)
  { id: 'back-left',   label: 'Back Left',   col: 0.17, row: 0.88, wC: 0.28, wR: 0.18 },
  { id: 'back-center', label: 'Back Center', col: 0.50, row: 0.88, wC: 0.28, wR: 0.18 },
  { id: 'back-right',  label: 'Back Right',  col: 0.83, row: 0.88, wC: 0.28, wR: 0.18 },
  // Middle row
  { id: 'mid-left',    label: 'Left',        col: 0.17, row: 0.52, wC: 0.28, wR: 0.18 },
  { id: 'mid-center',  label: 'Center',      col: 0.50, row: 0.52, wC: 0.28, wR: 0.18 },
  { id: 'mid-right',   label: 'Right',       col: 0.83, row: 0.52, wC: 0.28, wR: 0.18 },
  // Front row (closest to you)
  { id: 'front',       label: 'Front',       col: 0.50, row: 0.15, wC: 0.40, wR: 0.14 },
]

// ── Device metadata ───────────────────────────────────────────────────────────
export const DEVICE_META = [
  { id: 'monitor', label: 'Monitor',  desc: 'External display' },
  { id: 'laptop',  label: 'Laptop',   desc: 'MacBook / PC' },
  { id: 'ipad',    label: 'iPad',     desc: 'Tablet' },
  { id: 'phone',   label: 'Phone',    desc: 'Smartphone' },
  { id: 'camera',  label: 'Webcam',   desc: 'External camera' },
]

export const POSITION_LABELS = Object.fromEntries(ZONES.map(z => [z.id, z.label]))

export const DEVICE_TYPES = DEVICE_META.map(d => ({ id: d.id, label: d.label }))

// ── Device SVG components (perspective-scaled) ────────────────────────────────
// Each rendered at SVG center (cx, cy) with a depth scale

function DeviceMonitor({ cx, cy, scale, id = '' }) {
  const w = 110 * scale, h = 80 * scale, leg = 22 * scale, base = 36 * scale
  const gid = `mg_${id}`
  return (
    <g>
      {/* Shadow */}
      <ellipse cx={cx} cy={cy + h * 0.52} rx={w * 0.5} ry={h * 0.08} fill="black" opacity={0.12} />
      {/* Base */}
      <rect x={cx - base/2} y={cy + h/2 - 2} width={base} height={leg * 0.35} rx={3 * scale} fill="#2A2F3A" />
      {/* Neck */}
      <rect x={cx - 5*scale} y={cy + h/2 - leg} width={10 * scale} height={leg + 2} fill="#1E2330" />
      {/* Screen housing */}
      <rect x={cx - w/2} y={cy - h/2} width={w} height={h} rx={6 * scale} fill="#1A1D28" />
      {/* Bezel inner */}
      <rect x={cx - w/2 + 4*scale} y={cy - h/2 + 4*scale} width={w - 8*scale} height={h - 8*scale} rx={3 * scale} fill={`url(#${gid})`} />
      {/* Content lines */}
      <rect x={cx - w/2 + 14*scale} y={cy - h/2 + 22*scale} width={w * 0.35} height={2.5 * scale} rx={1.2*scale} fill="white" opacity={0.18} />
      <rect x={cx - w/2 + 14*scale} y={cy - h/2 + 28*scale} width={w * 0.25} height={2 * scale} rx={1*scale} fill="white" opacity={0.12} />
      <rect x={cx - w/2 + 14*scale} y={cy - h/2 + 34*scale} width={w * 0.30} height={2 * scale} rx={1*scale} fill="white" opacity={0.12} />
      {/* Shine */}
      <rect x={cx - w/2 + 4*scale} y={cy - h/2 + 4*scale} width={w - 8*scale} height={5 * scale} rx={2*scale} fill="white" opacity={0.05} />
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2A4ADF" stopOpacity="0.7" />
          <stop offset="40%" stopColor="#1A2FA0" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#080F30" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </g>
  )
}

function DeviceLaptop({ cx, cy, scale, id = '' }) {
  const w = 120 * scale, screenH = 72 * scale, baseH = 12 * scale
  const gid = `lg_${id}`
  const lidAngle = 0.3  // how much the lid recedes (perspective lean)
  // Screen top edge shifts back visually
  const topOffset = 18 * scale
  return (
    <g>
      {/* Shadow */}
      <ellipse cx={cx} cy={cy + screenH/2 + baseH + 4*scale} rx={w*0.52} ry={baseH*0.5} fill="black" opacity={0.12} />
      {/* Keyboard base */}
      <rect x={cx - w/2} y={cy + screenH/2 - baseH/2} width={w} height={baseH * 1.8} rx={4*scale} fill="#B0B8C4" />
      {/* Trackpad */}
      <rect x={cx - 18*scale} y={cy + screenH/2 + 2*scale} width={36*scale} height={10*scale} rx={3*scale} fill="#9AA2AE" opacity={0.8} />
      {/* Keyboard rows */}
      {[0,1,2].map(row => (
        <g key={row}>
          {[-36,-22,-8,6,20,34].map(kx => (
            <rect key={kx} x={cx + kx*scale - 4*scale} y={cy + screenH/2 - baseH/2 + 2*scale + row*3.2*scale}
              width={7*scale} height={2.2*scale} rx={0.8*scale} fill="#8A9AAA" opacity={0.6} />
          ))}
        </g>
      ))}
      {/* Screen (trapezoid — leaning back) */}
      <polygon
        points={`${cx - w/2 + topOffset},${cy - screenH/2} ${cx + w/2 - topOffset},${cy - screenH/2} ${cx + w/2},${cy + screenH/2} ${cx - w/2},${cy + screenH/2}`}
        fill="#1A1D28"
      />
      {/* Screen glow */}
      <polygon
        points={`${cx - w/2 + topOffset + 5*scale},${cy - screenH/2 + 5*scale} ${cx + w/2 - topOffset - 5*scale},${cy - screenH/2 + 5*scale} ${cx + w/2 - 5*scale},${cy + screenH/2 - 5*scale} ${cx - w/2 + 5*scale},${cy + screenH/2 - 5*scale}`}
        fill={`url(#${gid})`}
      />
      {/* Content */}
      <rect x={cx - w/2 + topOffset + 12*scale} y={cy - screenH/2 + 18*scale} width={w*0.3} height={2.5*scale} rx={1*scale} fill="white" opacity={0.15} />
      <rect x={cx - w/2 + topOffset + 12*scale} y={cy - screenH/2 + 24*scale} width={w*0.2} height={2*scale} rx={1*scale} fill="white" opacity={0.1} />
      {/* Hinge */}
      <rect x={cx - w/2} y={cy + screenH/2 - 3*scale} width={w} height={5*scale} rx={2*scale} fill="#888F9A" />
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2A4ADF" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#070C20" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </g>
  )
}

function DevicePhone({ cx, cy, scale, id = '' }) {
  const w = 38 * scale, h = 72 * scale, r = 7 * scale
  const gid = `phg_${id}`
  return (
    <g>
      <ellipse cx={cx} cy={cy + h/2 + 3*scale} rx={w*0.5} ry={4*scale} fill="black" opacity={0.13} />
      {/* Body */}
      <rect x={cx - w/2} y={cy - h/2} width={w} height={h} rx={r} fill="#17191F" />
      {/* Screen */}
      <rect x={cx - w/2 + 3*scale} y={cy - h/2 + 6*scale} width={w - 6*scale} height={h - 12*scale} rx={r - 2*scale} fill={`url(#${gid})`} />
      {/* Dynamic Island */}
      <rect x={cx - 8*scale} y={cy - h/2 + 9*scale} width={16*scale} height={5*scale} rx={2.5*scale} fill="#0D0E12" />
      {/* Home bar */}
      <rect x={cx - 10*scale} y={cy + h/2 - 10*scale} width={20*scale} height={3*scale} rx={1.5*scale} fill="#2A2D35" />
      {/* Side button */}
      <rect x={cx + w/2} y={cy - 8*scale} width={3*scale} height={16*scale} rx={1.5*scale} fill="#222530" />
      {/* Volume */}
      <rect x={cx - w/2 - 3*scale} y={cy - 12*scale} width={3*scale} height={10*scale} rx={1.5*scale} fill="#222530" />
      <rect x={cx - w/2 - 3*scale} y={cy + 2*scale} width={3*scale} height={10*scale} rx={1.5*scale} fill="#222530" />
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="60%" y2="100%">
          <stop offset="0%" stopColor="#1E3A7A" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#060B1A" stopOpacity="0.95" />
        </linearGradient>
      </defs>
    </g>
  )
}

function DeviceIPad({ cx, cy, scale, id = '' }) {
  const w = 80 * scale, h = 108 * scale, r = 8 * scale
  const gid = `ipg_${id}`
  return (
    <g>
      <ellipse cx={cx} cy={cy + h/2 + 4*scale} rx={w*0.5} ry={5*scale} fill="black" opacity={0.12} />
      {/* Body */}
      <rect x={cx - w/2} y={cy - h/2} width={w} height={h} rx={r} fill="#1C1F28" />
      {/* Screen */}
      <rect x={cx - w/2 + 5*scale} y={cy - h/2 + 8*scale} width={w - 10*scale} height={h - 16*scale} rx={r - 3*scale} fill={`url(#${gid})`} />
      {/* FaceID bar */}
      <rect x={cx - 12*scale} y={cy - h/2 + 4*scale} width={24*scale} height={3*scale} rx={1.5*scale} fill="#0D0E12" />
      {/* Home bar bottom */}
      <rect x={cx - 14*scale} y={cy + h/2 - 8*scale} width={28*scale} height={3*scale} rx={1.5*scale} fill="#2A2D35" />
      {/* Side button */}
      <rect x={cx + w/2} y={cy - 18*scale} width={3*scale} height={22*scale} rx={1.5*scale} fill="#222530" />
      {/* Content UI */}
      <rect x={cx - w/2 + 12*scale} y={cy - h/2 + 20*scale} width={w - 24*scale} height={2*scale} rx={1*scale} fill="white" opacity={0.12} />
      <rect x={cx - w/2 + 12*scale} y={cy - h/2 + 25*scale} width={(w - 24*scale) * 0.7} height={2*scale} rx={1*scale} fill="white" opacity={0.08} />
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1F3A8F" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#060C1E" stopOpacity="0.92" />
        </linearGradient>
      </defs>
    </g>
  )
}

function DeviceCamera({ cx, cy, scale, id = '' }) {
  const bw = 72 * scale, bh = 44 * scale, r = 6 * scale
  const gid = `cg_${id}`
  return (
    <g>
      <ellipse cx={cx} cy={cy + bh/2 + 3*scale} rx={bw*0.48} ry={4*scale} fill="black" opacity={0.12} />
      {/* Body */}
      <rect x={cx - bw/2} y={cy - bh/2} width={bw} height={bh} rx={r} fill="#222530" />
      {/* Grip texture left */}
      <rect x={cx - bw/2} y={cy - bh/2} width={12*scale} height={bh} rx={r} fill="#1A1D24" />
      {/* Shutter bump top */}
      <rect x={cx - 10*scale} y={cy - bh/2 - 8*scale} width={22*scale} height={10*scale} rx={4*scale} fill="#1E2130" />
      {/* Lens outer ring */}
      <circle cx={cx + 6*scale} cy={cy + 2*scale} r={17*scale} fill="#111318" />
      <circle cx={cx + 6*scale} cy={cy + 2*scale} r={15*scale} fill="#0C0F14" stroke="#2A2D35" strokeWidth={1.5*scale} />
      <circle cx={cx + 6*scale} cy={cy + 2*scale} r={11*scale} fill={`url(#${gid})`} />
      <circle cx={cx + 6*scale} cy={cy + 2*scale} r={6*scale} fill="#070A10" />
      {/* Lens reflection */}
      <ellipse cx={cx + 1*scale} cy={cy - 3*scale} rx={4*scale} ry={2*scale} fill="white" opacity={0.18} transform={`rotate(-35, ${cx + 1*scale}, ${cy - 3*scale})`} />
      {/* Flash */}
      <rect x={cx - bw/2 + 16*scale} y={cy - 8*scale} width={10*scale} height={7*scale} rx={2*scale} fill="#FFD060" opacity={0.75} />
      <rect x={cx - bw/2 + 16*scale} y={cy - 8*scale} width={10*scale} height={7*scale} rx={2*scale} fill="white" opacity={0.1} />
      {/* Mode dial top */}
      <circle cx={cx - bw/2 + 26*scale} cy={cy - bh/2 - 3*scale} r={7*scale} fill="#2C303C" />
      <circle cx={cx - bw/2 + 26*scale} cy={cy - bh/2 - 3*scale} r={4*scale} fill="#383C48" />
      {/* Top shutter button */}
      <circle cx={cx - 10*scale} cy={cy - bh/2 - 3*scale} r={5*scale} fill="#383C48" />
      <circle cx={cx - 10*scale} cy={cy - bh/2 - 3*scale} r={3*scale} fill="#2C3040" />
      <defs>
        <radialGradient id={gid} cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#1E3560" />
          <stop offset="60%" stopColor="#0E1830" />
          <stop offset="100%" stopColor="#050810" />
        </radialGradient>
      </defs>
    </g>
  )
}

const DEVICE_RENDERERS = {
  monitor: DeviceMonitor,
  laptop:  DeviceLaptop,
  phone:   DevicePhone,
  ipad:    DeviceIPad,
  camera:  DeviceCamera,
}

// ── Palette icon (small sidebar) ─────────────────────────────────────────────
function PaletteIcon({ id, selected, onClick }) {
  const Renderer = DEVICE_RENDERERS[id]
  const meta = DEVICE_META.find(d => d.id === id)
  const iconScale = id === 'monitor' ? 0.22 : id === 'laptop' ? 0.2 : id === 'ipad' ? 0.18 : id === 'camera' ? 0.24 : 0.18
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '10px 6px',
        background: selected ? '#1a2e4a0f' : '#f8fafc',
        border: `2px solid ${selected ? '#1a2e4a' : '#e2e8f0'}`,
        borderRadius: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
        minWidth: 70,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = '#94a3b8' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = '#e2e8f0' }}
    >
      <svg width={56} height={46} viewBox="0 0 56 46" overflow="visible">
        <Renderer cx={28} cy={23} scale={iconScale} id={`pal_${id}`} />
      </svg>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
        color: selected ? '#1a2e4a' : '#64748b',
      }}>
        {meta?.label}
      </span>
    </button>
  )
}

// ── Zone polygon for click ────────────────────────────────────────────────────
function ZonePolygon({ zone, filled, selected, onClick }) {
  const { col, row, wC, wR } = zone
  const pts = [
    dp(col - wC/2, row - wR/2),
    dp(col + wC/2, row - wR/2),
    dp(col + wC/2, row + wR/2),
    dp(col - wC/2, row + wR/2),
  ].join(' ')

  return (
    <polygon
      points={pts}
      fill={selected ? 'rgba(26,46,74,0.1)' : filled ? 'transparent' : 'rgba(0,0,0,0)'}
      stroke={selected ? '#1a2e4a' : filled ? 'transparent' : '#94a3b840'}
      strokeWidth={selected ? 2 : 1}
      strokeDasharray={selected ? 'none' : '4,3'}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    />
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function IsometricWorkspace({ devices, setDevices, onContinue }) {
  const [selectedDevice, setSelectedDevice] = useState(null)

  const zoneMap = {}
  devices.forEach(d => { zoneMap[d.position] = d.type })

  const handleZoneClick = (zoneId) => {
    if (!selectedDevice) {
      if (zoneMap[zoneId]) {
        setDevices(prev => prev.filter(d => d.position !== zoneId))
      }
      return
    }
    setDevices(prev => {
      const filtered = prev.filter(d => d.position !== zoneId)
      return [...filtered, { position: zoneId, type: selectedDevice }]
    })
  }

  const handleDeviceSelect = (id) => {
    setSelectedDevice(prev => prev === id ? null : id)
  }

  const hasDevices = devices.length > 0
  const selectedMeta = DEVICE_META.find(d => d.id === selectedDevice)

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      background: '#F7F6F2',
      fontFamily: 'inherit',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '24px 32px 16px',
        borderBottom: '1px solid #E8E4DC',
        background: '#FAFAF8',
      }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.022em', margin: 0 }}>
            Your Workspace
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
            {selectedDevice
              ? `Click a spot on the desk to place your ${selectedMeta?.label}`
              : 'Select a device from the list, then click the desk to place it'}
          </p>
        </div>
        <button
          onClick={onContinue}
          style={{
            padding: '10px 26px', fontSize: 14, fontWeight: 700,
            background: '#1a2e4a', color: '#fff',
            border: 'none', borderRadius: 12,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 2px 8px #1a2e4a30',
          }}
        >
          {hasDevices ? 'Save & Continue' : 'Skip →'}
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Desk scene */}
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px 0 32px',
        }}>
          <svg
            width={W} height={H + 30}
            viewBox={`0 0 ${W} ${H + 30}`}
            style={{ overflow: 'visible', maxWidth: '100%' }}
          >
            <defs>
              {/* Desk wood grain gradient */}
              <linearGradient id="deskTop" x1="20%" y1="0%" x2="80%" y2="100%">
                <stop offset="0%"   stopColor="#E8E0CE" />
                <stop offset="40%"  stopColor="#DDD4BC" />
                <stop offset="70%"  stopColor="#D4C8AA" />
                <stop offset="100%" stopColor="#C8BAA0" />
              </linearGradient>
              {/* Desk edge (near) */}
              <linearGradient id="deskEdge" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#B8A888" />
                <stop offset="100%" stopColor="#A09070" />
              </linearGradient>
              {/* Floor */}
              <linearGradient id="floorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#DEDACE" />
                <stop offset="100%" stopColor="#C8C4B8" />
              </linearGradient>
              {/* Vignette on desk */}
              <radialGradient id="deskVignette" cx="50%" cy="60%" r="60%">
                <stop offset="0%" stopColor="transparent" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.06)" />
              </radialGradient>
              {/* Subtle wood grain lines */}
              <pattern id="grain" x="0" y="0" width="40" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-5)">
                <rect width="40" height="8" fill="none"/>
                <line x1="0" y1="2" x2="40" y2="2" stroke="rgba(100,80,40,0.04)" strokeWidth="1"/>
                <line x1="0" y1="5" x2="40" y2="5" stroke="rgba(100,80,40,0.03)" strokeWidth="0.5"/>
              </pattern>
            </defs>

            {/* Floor */}
            <rect x={0} y={DESK_NEAR_Y + 18} width={W} height={60} fill="url(#floorGrad)" />

            {/* Desk legs */}
            {[
              [DESK_NEAR_L + 20, DESK_NEAR_Y + 4],
              [DESK_NEAR_R - 20, DESK_NEAR_Y + 4],
              [DESK_FAR_L + 12, DESK_FAR_Y + 14],
              [DESK_FAR_R - 12, DESK_FAR_Y + 14],
            ].map(([lx, ly], i) => (
              <g key={i}>
                <rect
                  x={lx - 7} y={ly}
                  width={14} height={DESK_NEAR_Y + 20 - ly}
                  rx={3}
                  fill={i < 2 ? '#2C2C2C' : '#252525'}
                  opacity={i >= 2 ? 0.55 : 1}
                />
                {/* Leg cap */}
                <rect x={lx - 9} y={DESK_NEAR_Y + 16} width={18} height={6} rx={2} fill="#1A1A1A" opacity={i < 2 ? 1 : 0} />
              </g>
            ))}

            {/* Desk surface — trapezoid */}
            <polygon
              points={`${DESK_FAR_L},${DESK_FAR_Y} ${DESK_FAR_R},${DESK_FAR_Y} ${DESK_NEAR_R},${DESK_NEAR_Y} ${DESK_NEAR_L},${DESK_NEAR_Y}`}
              fill="url(#deskTop)"
            />
            {/* Wood grain */}
            <polygon
              points={`${DESK_FAR_L},${DESK_FAR_Y} ${DESK_FAR_R},${DESK_FAR_Y} ${DESK_NEAR_R},${DESK_NEAR_Y} ${DESK_NEAR_L},${DESK_NEAR_Y}`}
              fill="url(#grain)" opacity={0.8}
            />
            {/* Vignette */}
            <polygon
              points={`${DESK_FAR_L},${DESK_FAR_Y} ${DESK_FAR_R},${DESK_FAR_Y} ${DESK_NEAR_R},${DESK_NEAR_Y} ${DESK_NEAR_L},${DESK_NEAR_Y}`}
              fill="url(#deskVignette)"
            />

            {/* Front edge of desk (thickness) */}
            <polygon
              points={`${DESK_NEAR_L},${DESK_NEAR_Y} ${DESK_NEAR_R},${DESK_NEAR_Y} ${DESK_NEAR_R + 8},${DESK_NEAR_Y + 18} ${DESK_NEAR_L - 8},${DESK_NEAR_Y + 18}`}
              fill="url(#deskEdge)"
            />
            {/* Edge highlight */}
            <line x1={DESK_NEAR_L} y1={DESK_NEAR_Y} x2={DESK_NEAR_R} y2={DESK_NEAR_Y} stroke="white" strokeWidth={1.5} opacity={0.3} />
            {/* Far edge */}
            <line x1={DESK_FAR_L} y1={DESK_FAR_Y} x2={DESK_FAR_R} y2={DESK_FAR_Y} stroke="white" strokeWidth={0.8} opacity={0.15} />

            {/* Zone click areas */}
            {ZONES.map(zone => (
              <ZonePolygon
                key={zone.id}
                zone={zone}
                filled={!!zoneMap[zone.id]}
                selected={selectedDevice !== null}
                onClick={() => handleZoneClick(zone.id)}
              />
            ))}

            {/* Zone labels (empty zones) */}
            {ZONES.map(zone => {
              if (zoneMap[zone.id]) return null
              const sx = deskX(zone.col, zone.row)
              const sy = deskY(zone.row)
              return (
                <text
                  key={`lbl_${zone.id}`}
                  x={sx} y={sy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10 + (1 - zone.row) * 3}
                  fontWeight="700"
                  fill={selectedDevice ? '#1a2e4a70' : '#a0a8b4'}
                  style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                  onClick={() => handleZoneClick(zone.id)}
                >
                  {zone.label}
                </text>
              )
            })}

            {/* Placed devices */}
            {ZONES.map(zone => {
              const deviceId = zoneMap[zone.id]
              if (!deviceId) return null
              const Renderer = DEVICE_RENDERERS[deviceId]
              if (!Renderer) return null
              const scale = depthScale(1 - zone.row) // row=0 near → scale=1
              const sx = deskX(zone.col, zone.row)
              const sy = deskY(zone.row)
              return (
                <g key={zone.id} style={{ cursor: 'pointer' }} onClick={() => {
                  setDevices(prev => prev.filter(d => d.position !== zone.id))
                }}>
                  <Renderer cx={sx} cy={sy} scale={scale} id={zone.id} />
                  {/* Remove hint on hover - invisible large hit area */}
                  <circle cx={sx} cy={sy} r={40 * scale} fill="transparent" />
                </g>
              )
            })}

            {/* "You are here" indicator at bottom */}
            <g transform={`translate(${W/2}, ${H + 10})`}>
              <rect x={-36} y={-10} width={72} height={20} rx={10} fill="#1a2e4a15" />
              <text textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="700"
                fill="#1a2e4a80" letterSpacing="0.08em">
                ↑ YOU ARE HERE
              </text>
            </g>
          </svg>
        </div>

        {/* Sidebar */}
        <div style={{
          width: 192,
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '20px 16px',
          background: '#FAFAF8',
          borderLeft: '1px solid #E8E4DC',
          overflowY: 'auto',
        }}>
          <p style={{
            fontSize: 10, fontWeight: 800, color: '#94a3b8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            margin: '0 0 6px',
          }}>
            Devices
          </p>

          {DEVICE_META.map(d => (
            <PaletteIcon
              key={d.id}
              id={d.id}
              selected={selectedDevice === d.id}
              onClick={() => handleDeviceSelect(d.id)}
            />
          ))}

          {/* Placed list */}
          {hasDevices && (
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <p style={{
                fontSize: 10, fontWeight: 800, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px',
              }}>Placed</p>
              {devices.map((d, i) => {
                const meta = DEVICE_META.find(m => m.id === d.type)
                const zone = ZONES.find(z => z.id === d.position)
                return (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '3px 0', fontSize: 11,
                  }}>
                    <span style={{ fontWeight: 600, color: '#374151' }}>{meta?.label}</span>
                    <span style={{ color: '#94a3b8', fontSize: 10 }}>{zone?.label}</span>
                  </div>
                )
              })}
              <button
                onClick={() => setDevices([])}
                style={{
                  marginTop: 8, width: '100%', padding: '6px',
                  fontSize: 11, color: '#94a3b8',
                  background: 'none', border: '1px solid #e2e8f0',
                  borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Clear all
              </button>
            </div>
          )}

          {/* Hint */}
          <p style={{
            fontSize: 10, color: '#b0bac8', marginTop: 8, lineHeight: 1.5, textAlign: 'center',
          }}>
            Click a placed device to remove it
          </p>
        </div>
      </div>
    </div>
  )
}
