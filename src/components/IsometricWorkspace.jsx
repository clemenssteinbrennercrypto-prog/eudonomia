import { useState } from 'react'

// ── Isometric Projection ──────────────────────────────────────────────────────
// x-axis → right-down, z-axis → left-down, y-axis → up
const S  = 30     // px per world unit
const OX = 310    // SVG origin
const OY = 260

function px(x, y, z) { return OX + (x - z) * S }
function py(x, y, z) { return OY + (x + z) * S * 0.5 - y * S }
function p(x, y, z)  { return `${px(x,y,z).toFixed(1)},${py(x,y,z).toFixed(1)}` }

// ── Primitives ────────────────────────────────────────────────────────────────
function IsoBox({ x, y, z, w, h, d, top, right, front, so = '#00000012', sw = 0.6 }) {
  const X=x, Y=y, Z=z
  return (
    <g>
      {/* Right face (high-x, lit from right) */}
      <polygon points={[p(X+w,Y,Z),p(X+w,Y+h,Z),p(X+w,Y+h,Z+d),p(X+w,Y,Z+d)].join(' ')}
        fill={right} stroke={so} strokeWidth={sw} />
      {/* Front face (high-z, toward camera) */}
      <polygon points={[p(X,Y,Z+d),p(X+w,Y,Z+d),p(X+w,Y+h,Z+d),p(X,Y+h,Z+d)].join(' ')}
        fill={front} stroke={so} strokeWidth={sw} />
      {/* Top face */}
      <polygon points={[p(X,Y+h,Z),p(X+w,Y+h,Z),p(X+w,Y+h,Z+d),p(X,Y+h,Z+d)].join(' ')}
        fill={top} stroke={so} strokeWidth={sw} />
    </g>
  )
}

// Flat diamond tile on a surface (for zone highlighting)
function IsoTile({ x, y, z, w, d, fill, stroke, strokeWidth = 1 }) {
  return (
    <polygon
      points={[p(x,y,z),p(x+w,y,z),p(x+w,y,z+d),p(x,y,z+d)].join(' ')}
      fill={fill} stroke={stroke} strokeWidth={strokeWidth}
    />
  )
}

// ── Desk ──────────────────────────────────────────────────────────────────────
// Desk: x=[0,5], z=[1,4], surface at y=DY
const DY = 2.2

const DESK_TOP   = '#EDE9DF'
const DESK_RIGHT = '#D5CEBC'
const DESK_FRONT = '#C4B9A5'
const LEG_TOP    = '#2E2E2E'
const LEG_RIGHT  = '#222222'
const LEG_FRONT  = '#181818'
const FLOOR_COL  = '#E2DACE'

function Desk() {
  return (
    <g>
      {/* Floor plane */}
      <polygon
        points={[p(-1,0,0),p(7,0,0),p(7,0,6),p(-1,0,6)].join(' ')}
        fill={FLOOR_COL}
      />
      {/* 4 legs */}
      {[
        [0.18, 1.15], [4.62, 1.15],
        [0.18, 3.65], [4.62, 3.65],
      ].map(([lx, lz], i) => (
        <IsoBox key={i} x={lx} y={0} z={lz} w={0.2} h={DY} d={0.2}
          top={LEG_TOP} right={LEG_RIGHT} front={LEG_FRONT} />
      ))}
      {/* Desk slab */}
      <IsoBox x={0} y={DY} z={1} w={5} h={0.18} d={3}
        top={DESK_TOP} right={DESK_RIGHT} front={DESK_FRONT} />
    </g>
  )
}

// ── Device 3D shapes ──────────────────────────────────────────────────────────
// All devices placed with (cx, cz) = world center on desk surface

function IsoMonitor({ cx, cz, id = 0 }) {
  const y = DY + 0.18
  const bx = cx - 0.55, bz = cz - 0.25
  const sx = cx - 0.62, sz = cz + 0.02
  const gradId = `monitorScreen_${id}`
  return (
    <g>
      {/* Base plate */}
      <IsoBox x={bx} y={y} z={bz} w={1.1} h={0.06} d={0.42}
        top="#3A3A3A" right="#2A2A2A" front="#222222" />
      {/* Neck */}
      <IsoBox x={cx-0.07} y={y+0.06} z={cz-0.07} w={0.14} h={0.58} d={0.14}
        top="#333" right="#252525" front="#1C1C1C" />
      {/* Screen housing */}
      <IsoBox x={sx} y={y+0.64} z={sz} w={1.24} h={0.82} d={0.09}
        top="#1C2030" right="#222838" front="#2A3048" />
      {/* Screen face glow */}
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4A7AFF" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#2A4FCC" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#1A3080" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* Screen display surface */}
      <polygon
        points={[
          p(sx+0.07, y+0.67, sz+0.09),
          p(sx+1.17, y+0.67, sz+0.09),
          p(sx+1.17, y+0.64+0.75, sz+0.09),
          p(sx+0.07, y+0.64+0.75, sz+0.09),
        ].join(' ')}
        fill={`url(#${gradId})`}
      />
      {/* Inner UI lines */}
      <polygon
        points={[p(sx+0.15,y+0.72,sz+0.09),p(sx+0.7,y+0.72,sz+0.09),p(sx+0.7,y+0.74,sz+0.09),p(sx+0.15,y+0.74,sz+0.09)].join(' ')}
        fill="white" opacity="0.15" />
      <polygon
        points={[p(sx+0.15,y+0.76,sz+0.09),p(sx+0.55,y+0.76,sz+0.09),p(sx+0.55,y+0.78,sz+0.09),p(sx+0.15,y+0.78,sz+0.09)].join(' ')}
        fill="white" opacity="0.1" />
    </g>
  )
}

function IsoLaptop({ cx, cz, id = 0 }) {
  const y = DY + 0.18
  return (
    <g>
      {/* Base (keyboard) */}
      <IsoBox x={cx-0.7} y={y} z={cz-0.5} w={1.4} h={0.06} d={1.0}
        top="#B8BFC8" right="#9AA2AA" front="#8A9298" />
      {/* Screen lid (angled approximation — leaning box) */}
      <IsoBox x={cx-0.65} y={y+0.06} z={cz-0.5} w={1.3} h={0.78} d={0.07}
        top="#A8B0B8" right="#9298A0" front="#B8C0C8" />
      {/* Screen glow on lid front face */}
      <defs>
        <linearGradient id={`laptop_${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3A6AEF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#1A3ACC" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <polygon
        points={[
          p(cx-0.58, y+0.1, cz-0.5+0.07),
          p(cx+0.58, y+0.1, cz-0.5+0.07),
          p(cx+0.58, y+0.06+0.7, cz-0.5+0.07),
          p(cx-0.58, y+0.06+0.7, cz-0.5+0.07),
        ].join(' ')}
        fill={`url(#laptop_${id})`}
      />
      {/* Trackpad */}
      <IsoBox x={cx-0.22} y={y+0.06} z={cz+0.15} w={0.44} h={0.01} d={0.28}
        top="#A0A8B0" right="#909098" front="#888890" />
    </g>
  )
}

function IsoPhone({ cx, cz, id = 0 }) {
  const y = DY + 0.18
  return (
    <g>
      {/* Body */}
      <IsoBox x={cx-0.13} y={y} z={cz-0.07} w={0.26} h={0.52} d={0.14}
        top="#1A1A1A" right="#111" front="#0D0D0D" />
      {/* Screen front face */}
      <polygon
        points={[
          p(cx-0.1, y+0.05, cz-0.07+0.14),
          p(cx+0.1, y+0.05, cz-0.07+0.14),
          p(cx+0.1, y+0.46, cz-0.07+0.14),
          p(cx-0.1, y+0.46, cz-0.07+0.14),
        ].join(' ')}
        fill="#1E3A6E"
        opacity="0.85"
      />
      {/* Dynamic island */}
      <polygon
        points={[
          p(cx-0.04, y+0.44, cz-0.07+0.14),
          p(cx+0.04, y+0.44, cz-0.07+0.14),
          p(cx+0.04, y+0.46, cz-0.07+0.14),
          p(cx-0.04, y+0.46, cz-0.07+0.14),
        ].join(' ')}
        fill="#0A0A0A"
      />
    </g>
  )
}

function IsoIPad({ cx, cz, id = 0 }) {
  const y = DY + 0.18
  return (
    <g>
      {/* Body - laying flat */}
      <IsoBox x={cx-0.5} y={y} z={cz-0.35} w={1.0} h={0.05} d={0.7}
        top="#C8CDD5" right="#A8ADB5" front="#9098A0" />
      {/* Screen on top */}
      <polygon
        points={[
          p(cx-0.44, y+0.05, cz-0.28),
          p(cx+0.44, y+0.05, cz-0.28),
          p(cx+0.44, y+0.05, cz+0.28),
          p(cx-0.44, y+0.05, cz+0.28),
        ].join(' ')}
        fill="#1E2A40"
        opacity="0.7"
      />
    </g>
  )
}

function IsoCamera({ cx, cz, id = 0 }) {
  const y = DY + 0.18
  return (
    <g>
      {/* Body */}
      <IsoBox x={cx-0.25} y={y} z={cz-0.2} w={0.5} h={0.35} d={0.38}
        top="#2C2C2C" right="#222" front="#1C1C1C" />
      {/* Lens ring */}
      {(() => {
        const lx = px(cx, y+0.17, cz-0.2+0.38)
        const ly = py(cx, y+0.17, cz-0.2+0.38)
        return (
          <g transform={`translate(${lx}, ${ly})`}>
            <ellipse rx={9} ry={5} fill="#111" stroke="#333" strokeWidth={1.5} />
            <ellipse rx={6} ry={3.3} fill="#1A2840" stroke="#222" strokeWidth={1} />
            <ellipse rx={3} ry={1.6} fill="#0D1520" />
            <ellipse cx={-2} cy={-1} rx={1.5} ry={0.8} fill="white" opacity={0.2} />
          </g>
        )
      })()}
      {/* Flash */}
      <IsoBox x={cx+0.12} y={y+0.23} z={cz-0.2} w={0.08} h={0.08} d={0.04}
        top="#FFD060" right="#E0B040" front="#C0901C" />
    </g>
  )
}

// Device registry
const DEVICE_SHAPES = {
  monitor: IsoMonitor,
  laptop:  IsoLaptop,
  phone:   IsoPhone,
  ipad:    IsoIPad,
  camera:  IsoCamera,
}

const DEVICE_META = [
  { id: 'monitor', label: 'Monitor',   desc: 'External display' },
  { id: 'laptop',  label: 'Laptop',    desc: 'MacBook / PC laptop' },
  { id: 'ipad',    label: 'iPad',      desc: 'Tablet / iPad' },
  { id: 'phone',   label: 'Phone',     desc: 'Smartphone' },
  { id: 'camera',  label: 'Webcam',    desc: 'External camera' },
]

// ── Placement Zones ──────────────────────────────────────────────────────────
const ZONES = [
  { id: 'back-left',    label: 'Back Left',    cx: 0.8,  cz: 1.6,  w: 1.3, d: 0.9 },
  { id: 'back-center',  label: 'Back Center',  cx: 2.5,  cz: 1.6,  w: 1.3, d: 0.9 },
  { id: 'back-right',   label: 'Back Right',   cx: 4.2,  cz: 1.6,  w: 1.3, d: 0.9 },
  { id: 'mid-left',     label: 'Left',         cx: 0.85, cz: 2.6,  w: 1.3, d: 0.9 },
  { id: 'mid-center',   label: 'Center',       cx: 2.5,  cz: 2.7,  w: 1.5, d: 1.1 },
  { id: 'mid-right',    label: 'Right',        cx: 4.15, cz: 2.6,  w: 1.3, d: 0.9 },
  { id: 'front',        label: 'Front Edge',   cx: 2.5,  cz: 3.6,  w: 2.0, d: 0.6 },
]

// ── Mini device icon for palette ─────────────────────────────────────────────
function DevicePaletteIcon({ id, selected, onClick }) {
  const icons = {
    monitor: (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="4" y="4" width="30" height="20" rx="2" fill="#1e293b"/>
        <rect x="6" y="6" width="26" height="16" rx="1" fill="url(#pm)"/>
        <rect x="15" y="24" width="8" height="5" rx="1" fill="#334155"/>
        <rect x="11" y="28" width="16" height="3" rx="1.5" fill="#334155"/>
        <defs><linearGradient id="pm" x1="0" y1="0" x2="26" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" stopOpacity=".5"/><stop offset="1" stopColor="#1d4ed8" stopOpacity=".1"/>
        </linearGradient></defs>
      </svg>
    ),
    laptop: (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="5" y="6" width="28" height="18" rx="2" fill="#1e293b"/>
        <rect x="7" y="8" width="24" height="14" rx="1" fill="url(#pl)"/>
        <path d="M3 24h32l-2 6H5z" fill="#334155"/>
        <defs><linearGradient id="pl" x1="0" y1="0" x2="24" y2="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" stopOpacity=".4"/><stop offset="1" stopColor="#1d4ed8" stopOpacity=".1"/>
        </linearGradient></defs>
      </svg>
    ),
    ipad: (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="7" y="3" width="24" height="32" rx="3" fill="#1e293b"/>
        <rect x="9" y="7" width="20" height="24" rx="2" fill="url(#pi)"/>
        <circle cx="19" cy="34" r="2" fill="#334155"/>
        <defs><linearGradient id="pi" x1="0" y1="0" x2="20" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" stopOpacity=".4"/><stop offset="1" stopColor="#1d4ed8" stopOpacity=".1"/>
        </linearGradient></defs>
      </svg>
    ),
    phone: (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="11" y="2" width="16" height="34" rx="4" fill="#1e293b"/>
        <rect x="13" y="6" width="12" height="22" rx="2" fill="url(#pp)"/>
        <rect x="15" y="4" width="8" height="2" rx="1" fill="#334155"/>
        <rect x="15" y="30" width="8" height="2" rx="1" fill="#334155"/>
        <defs><linearGradient id="pp" x1="0" y1="0" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1e40af" stopOpacity=".7"/><stop offset="1" stopColor="#0f172a" stopOpacity=".9"/>
        </linearGradient></defs>
      </svg>
    ),
    camera: (
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
        <rect x="3" y="10" width="32" height="22" rx="4" fill="#1e293b"/>
        <rect x="14" y="6" width="10" height="6" rx="2" fill="#1e293b"/>
        <circle cx="19" cy="21" r="8" fill="#0f172a"/>
        <circle cx="19" cy="21" r="6" fill="#0a0f1a"/>
        <circle cx="19" cy="21" r="3.5" fill="url(#pc)"/>
        <ellipse cx="16.5" cy="18.5" rx="1.5" ry="1" fill="white" opacity=".2"/>
        <defs><radialGradient id="pc" cx="40%" cy="35%"><stop stopColor="#1e3a5f"/><stop offset="1" stopColor="#0a0f1a"/></radialGradient></defs>
      </svg>
    ),
  }
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '10px 8px',
        background: selected ? '#1a2e4a12' : '#f8fafc',
        border: `2px solid ${selected ? '#1a2e4a' : '#e2e8f0'}`,
        borderRadius: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
        minWidth: 64,
      }}
    >
      {icons[id]}
      <span style={{ fontSize: 11, fontWeight: 600, color: selected ? '#1a2e4a' : '#475569', letterSpacing: '0.02em' }}>
        {DEVICE_META.find(d => d.id === id)?.label}
      </span>
    </button>
  )
}

// ── Zone click area (isometric polygon as clickable overlay) ─────────────────
function ZoneOverlay({ zone, filled, selected, onClick }) {
  const { cx, cz, w, d } = zone
  const x = cx - w/2, z = cz - d/2
  const y = DY + 0.19 // just above desk surface
  const pts = [p(x,y,z),p(x+w,y,z),p(x+w,y,z+d),p(x,y,z+d)].join(' ')

  return (
    <polygon
      points={pts}
      fill={filled ? 'rgba(26,46,74,0.08)' : selected ? 'rgba(26,46,74,0.12)' : 'transparent'}
      stroke={selected ? '#1a2e4a' : filled ? '#1a2e4a60' : '#1a2e4a30'}
      strokeWidth={selected ? 1.5 : 1}
      strokeDasharray={filled ? 'none' : '3,2'}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    />
  )
}

// ── Zone label in isometric space ─────────────────────────────────────────────
function ZoneLabel({ zone, filled, selectedZone }) {
  if (filled) return null
  const { cx, cz, label } = zone
  const lx = px(cx, DY+0.19, cz)
  const ly = py(cx, DY+0.19, cz)
  return (
    <text
      x={lx} y={ly}
      textAnchor="middle" dominantBaseline="middle"
      fontSize="9"
      fontWeight="600"
      fill={selectedZone === zone.id ? '#1a2e4a' : '#94a3b8'}
      style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.04em', textTransform: 'uppercase' }}
    >
      {label}
    </text>
  )
}

// ── Placed device label ───────────────────────────────────────────────────────
function PlacedLabel({ zone, deviceId }) {
  const lx = px(zone.cx, DY + 1.6, zone.cz)
  const ly = py(zone.cx, DY + 1.6, zone.cz) - 6
  const meta = DEVICE_META.find(d => d.id === deviceId)
  return (
    <text x={lx} y={ly} textAnchor="middle" fontSize="8.5" fontWeight="700"
      fill="#1a2e4a" opacity="0.6"
      style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {meta?.label}
    </text>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IsometricWorkspace({ devices, setDevices, onContinue }) {
  const [selectedDevice, setSelectedDevice] = useState(null) // device type to place
  const [selectedZone,   setSelectedZone]   = useState(null)

  // Map zone id → device
  const zoneMap = {}
  devices.forEach(d => { zoneMap[d.position] = d.type })

  const handleZoneClick = (zoneId) => {
    if (!selectedDevice) {
      // If a device is here, clicking removes it
      if (zoneMap[zoneId]) {
        setDevices(prev => prev.filter(d => d.position !== zoneId))
      } else {
        setSelectedZone(zoneId)
      }
      return
    }
    // Place selected device in zone (replace if occupied)
    setDevices(prev => {
      const filtered = prev.filter(d => d.position !== zoneId)
      return [...filtered, { position: zoneId, type: selectedDevice }]
    })
    setSelectedZone(null)
  }

  const handleDeviceSelect = (deviceId) => {
    setSelectedDevice(prev => prev === deviceId ? null : deviceId)
    setSelectedZone(null)
  }

  const hasDevices = devices.length > 0

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: '#FAFAF8', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.025em', margin: 0 }}>
            Your Workspace
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', marginTop: 5, margin: '5px 0 0' }}>
            {selectedDevice
              ? `Click a zone on the desk to place your ${DEVICE_META.find(d=>d.id===selectedDevice)?.label}`
              : 'Select a device, then click a desk zone to place it'}
          </p>
        </div>
        <button
          onClick={onContinue}
          style={{
            padding: '10px 24px', fontSize: 14, fontWeight: 700,
            background: '#1a2e4a', color: '#fff',
            border: 'none', borderRadius: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {hasDevices ? 'Save & Continue' : 'Skip →'}
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, gap: 0 }}>

        {/* 3D scene */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0 32px' }}>
          <svg
            width={640} height={460}
            viewBox="0 0 640 460"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#00000018" />
              </filter>
            </defs>

            {/* Scene */}
            <g filter="url(#shadow)">
              <Desk />

              {/* Placed devices */}
              {ZONES.map(zone => {
                const deviceId = zoneMap[zone.id]
                if (!deviceId) return null
                const DeviceComp = DEVICE_SHAPES[deviceId]
                if (!DeviceComp) return null
                return (
                  <g key={zone.id} style={{ cursor: 'pointer' }} onClick={() => handleZoneClick(zone.id)}>
                    <DeviceComp cx={zone.cx} cz={zone.cz} id={zone.id} />
                    <PlacedLabel zone={zone} deviceId={deviceId} />
                  </g>
                )
              })}
            </g>

            {/* Zone overlays (rendered on top) */}
            {ZONES.map(zone => (
              <g key={`zone-${zone.id}`}>
                <ZoneOverlay
                  zone={zone}
                  filled={!!zoneMap[zone.id]}
                  selected={selectedZone === zone.id}
                  onClick={() => handleZoneClick(zone.id)}
                />
                <ZoneLabel zone={zone} filled={!!zoneMap[zone.id]} selectedZone={selectedZone} />
              </g>
            ))}

            {/* Cursor hint */}
            {selectedDevice && (
              <text x={320} y={440} textAnchor="middle" fontSize="11" fill="#94a3b8" fontStyle="italic">
                Click a dashed zone to place · Click placed device to remove
              </text>
            )}
          </svg>
        </div>

        {/* Device palette sidebar */}
        <div style={{
          width: 180,
          padding: '20px 16px',
          borderLeft: '1px solid #e2e8f0',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
            Devices
          </p>
          {DEVICE_META.map(d => (
            <DevicePaletteIcon
              key={d.id}
              id={d.id}
              selected={selectedDevice === d.id}
              onClick={() => handleDeviceSelect(d.id)}
            />
          ))}

          {/* Legend */}
          {hasDevices && (
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Placed
              </p>
              {devices.map((d, i) => {
                const meta = DEVICE_META.find(m => m.id === d.type)
                const zone = ZONES.find(z => z.id === d.position)
                return (
                  <div key={i} style={{
                    fontSize: 11, color: '#475569', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center',
                    padding: '3px 0',
                  }}>
                    <span style={{ fontWeight: 600 }}>{meta?.label}</span>
                    <span style={{ color: '#94a3b8' }}>{zone?.label}</span>
                  </div>
                )
              })}
              <button
                onClick={() => setDevices([])}
                style={{
                  marginTop: 10, width: '100%', padding: '6px',
                  fontSize: 11, color: '#94a3b8', background: 'none',
                  border: '1px solid #e2e8f0', borderRadius: 8,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { ZONES as ISO_ZONES, DEVICE_META as ISO_DEVICE_META }
