import { useState, useRef, useCallback, useEffect } from 'react'

// ── Perspective mapping ────────────────────────────────────────────────────────
// Moderate perspective: 25° tilt, not bird's eye.
// col: 0=left … 1=right   row: 0=near(front) … 1=far(back)

const SVG_W = 680
const SVG_H = 460

// Desk corners in SVG space — less extreme foreshortening
const NEAR_L = 60,  NEAR_R = 620, NEAR_Y = 390
const FAR_L  = 190, FAR_R  = 490, FAR_Y  = 145

function deskToSVG(col, row) {
  const leftX  = NEAR_L + row * (FAR_L - NEAR_L)
  const rightX = NEAR_R + row * (FAR_R - NEAR_R)
  const y      = NEAR_Y + row * (FAR_Y - NEAR_Y)
  const x      = leftX + col * (rightX - leftX)
  return { x, y }
}

function svgToDeskCoords(sx, sy) {
  // Solve for row from y first
  const row = Math.max(0, Math.min(1, (sy - NEAR_Y) / (FAR_Y - NEAR_Y)))
  const leftX  = NEAR_L + row * (FAR_L - NEAR_L)
  const rightX = NEAR_R + row * (FAR_R - NEAR_R)
  const col = Math.max(0, Math.min(1, (sx - leftX) / (rightX - leftX)))
  return { col, row }
}

// Depth scale: devices at back are smaller
function depthScale(row) {
  return 1.0 - row * 0.38  // front=1.0, back=0.62
}

// ── Device metadata ───────────────────────────────────────────────────────────
const DEVICE_META = [
  { id: 'monitor',  label: 'Monitor'  },
  { id: 'laptop',   label: 'Laptop'   },
  { id: 'ipad',     label: 'iPad'     },
  { id: 'phone',    label: 'Phone'    },
  { id: 'camera',   label: 'Webcam'   },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'mouse',    label: 'Mouse'    },
]

const DEVICE_TYPES    = DEVICE_META.map(d => ({ id: d.id, label: d.label }))
const POSITION_LABELS = {}  // legacy compat — unused now

// ── Device renderers ──────────────────────────────────────────────────────────
// Each centered at (0,0), rendered at requested pixel size

function MonitorSVG({ w, h, uid }) {
  const sw = w, sh = h * 0.78
  const neckH = h * 0.12, neckW = w * 0.07
  const baseW = w * 0.38, baseH = h * 0.08
  return (
    <g>
      <ellipse cx={0} cy={sh/2 + neckH + baseH * 0.3} rx={baseW * 0.6} ry={baseH * 0.25} fill="black" opacity={0.15}/>
      <rect x={-baseW/2} y={sh/2 + neckH - 2} width={baseW} height={baseH} rx={baseH * 0.45} fill="#252830"/>
      <rect x={-neckW/2} y={sh/2} width={neckW} height={neckH + 2} fill="#1C1F28"/>
      <rect x={-sw/2} y={-sh/2} width={sw} height={sh} rx={6} fill="#16181F"/>
      <rect x={-sw/2 + 5} y={-sh/2 + 5} width={sw - 10} height={sh - 10} rx={4} fill={`url(#ms_${uid})`}/>
      <rect x={-sw/2 + 5} y={-sh/2 + 5} width={sw - 10} height={6} rx={2} fill="white" opacity={0.06}/>
      <rect x={-sw/2 + 14} y={-sh/2 + 24} width={sw * 0.36} height={3} rx={1.5} fill="white" opacity={0.2}/>
      <rect x={-sw/2 + 14} y={-sh/2 + 31} width={sw * 0.26} height={2.5} rx={1.2} fill="white" opacity={0.13}/>
      <rect x={-sw/2 + 14} y={-sh/2 + 37} width={sw * 0.30} height={2.5} rx={1.2} fill="white" opacity={0.13}/>
      <defs>
        <linearGradient id={`ms_${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#2E54E8" stopOpacity="0.75"/>
          <stop offset="50%"  stopColor="#1630A0" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#050A20" stopOpacity="0.95"/>
        </linearGradient>
      </defs>
    </g>
  )
}

function LaptopSVG({ w, h, uid }) {
  const baseH = h * 0.2, screenH = h * 0.72, lean = w * 0.12
  return (
    <g>
      <ellipse cx={0} cy={screenH/2 + baseH + 4} rx={w * 0.52} ry={baseH * 0.35} fill="black" opacity={0.13}/>
      <rect x={-w/2} y={screenH/2 - baseH * 0.1} width={w} height={baseH * 1.6} rx={4} fill="#A8B0BE"/>
      {[-3,-2,-1,0,1,2,3].flatMap((ki) => [0,1,2].map(row => (
        <rect key={`k${ki}_${row}`} x={ki * w/8 - w/18} y={screenH/2 + 3 + row * (baseH * 0.35)}
          width={w/9} height={baseH * 0.24} rx={1.5} fill="#8A92A0" opacity={0.65}/>
      )))}
      <rect x={-w * 0.22} y={screenH/2 + baseH * 0.7} width={w * 0.44} height={baseH * 0.55} rx={3} fill="#9098A8" opacity={0.7}/>
      <rect x={-w/2 + baseH*0.1} y={screenH/2 - baseH * 0.1} width={w - baseH * 0.2} height={5} rx={2} fill="#8890A0"/>
      <polygon
        points={`${-w/2 + lean},${-screenH/2} ${w/2 - lean},${-screenH/2} ${w/2},${screenH/2} ${-w/2},${screenH/2}`}
        fill="#16181F"
      />
      <polygon
        points={`${-w/2 + lean + 5},${-screenH/2 + 5} ${w/2 - lean - 5},${-screenH/2 + 5} ${w/2 - 5},${screenH/2 - 5} ${-w/2 + 5},${screenH/2 - 5}`}
        fill={`url(#ls_${uid})`}
      />
      <rect x={-w/2 + lean + 14} y={-screenH/2 + 18} width={w * 0.3} height={3} rx={1.5} fill="white" opacity={0.18}/>
      <rect x={-w/2 + lean + 14} y={-screenH/2 + 24} width={w * 0.2} height={2.5} rx={1.2} fill="white" opacity={0.12}/>
      <defs>
        <linearGradient id={`ls_${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2E54E8" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#050A20" stopOpacity="0.95"/>
        </linearGradient>
      </defs>
    </g>
  )
}

function PhoneSVG({ w, h, uid }) {
  const r = w * 0.22
  return (
    <g>
      <ellipse cx={0} cy={h/2 + 4} rx={w * 0.48} ry={5} fill="black" opacity={0.14}/>
      <rect x={-w/2} y={-h/2} width={w} height={h} rx={r} fill="#14151A"/>
      <rect x={-w/2 + 3} y={-h/2 + 7} width={w - 6} height={h - 14} rx={r - 2} fill={`url(#ps_${uid})`}/>
      <rect x={-w * 0.22} y={-h/2 + 10} width={w * 0.44} height={h * 0.07} rx={h * 0.035} fill="#0A0A0C"/>
      <rect x={-w * 0.25} y={h/2 - 12} width={w * 0.5} height={4} rx={2} fill="#222530"/>
      <rect x={w/2} y={-h * 0.15} width={4} height={h * 0.22} rx={2} fill="#1E2028"/>
      <rect x={-w/2 - 4} y={-h * 0.18} width={4} height={h * 0.14} rx={2} fill="#1E2028"/>
      <rect x={-w/2 - 4} y={h * 0.02} width={4} height={h * 0.14} rx={2} fill="#1E2028"/>
      <defs>
        <linearGradient id={`ps_${uid}`} x1="0%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%"   stopColor="#1840A0" stopOpacity="0.85"/>
          <stop offset="100%" stopColor="#050A1A" stopOpacity="0.97"/>
        </linearGradient>
      </defs>
    </g>
  )
}

function IPadSVG({ w, h, uid }) {
  const r = w * 0.1
  return (
    <g>
      <ellipse cx={0} cy={h/2 + 5} rx={w * 0.5} ry={6} fill="black" opacity={0.12}/>
      <rect x={-w/2} y={-h/2} width={w} height={h} rx={r} fill="#18191F"/>
      <rect x={-w/2 + 6} y={-h/2 + 9} width={w - 12} height={h - 18} rx={r - 3} fill={`url(#is_${uid})`}/>
      <rect x={-w * 0.18} y={-h/2 + 5} width={w * 0.36} height={3.5} rx={1.75} fill="#0C0D10"/>
      <rect x={-w * 0.22} y={h/2 - 10} width={w * 0.44} height={4} rx={2} fill="#222530"/>
      <rect x={w/2} y={-h * 0.1} width={3.5} height={h * 0.26} rx={1.75} fill="#1C1E26"/>
      <rect x={-w/2 + 12} y={-h/2 + 18} width={w * 0.4} height={3} rx={1.5} fill="white" opacity={0.12}/>
      <rect x={-w/2 + 12} y={-h/2 + 24} width={w * 0.28} height={2.5} rx={1.2} fill="white" opacity={0.08}/>
      <defs>
        <linearGradient id={`is_${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#1E3A9A" stopOpacity="0.78"/>
          <stop offset="100%" stopColor="#050A1C" stopOpacity="0.95"/>
        </linearGradient>
      </defs>
    </g>
  )
}

function CameraSVG({ w, h, uid }) {
  const bh = h * 0.72, br = 6
  return (
    <g>
      <ellipse cx={0} cy={bh/2 + 5} rx={w * 0.5} ry={5} fill="black" opacity={0.13}/>
      <rect x={-w/2} y={-bh/2} width={w} height={bh} rx={br} fill="#1E2130"/>
      <rect x={-w/2} y={-bh/2} width={w * 0.2} height={bh} rx={br} fill="#181A22"/>
      <rect x={-w * 0.18} y={-bh/2 - h * 0.2} width={w * 0.38} height={h * 0.22} rx={5} fill="#181A24"/>
      <circle cx={w * 0.08} cy={bh * 0.04} r={bh * 0.4} fill="#0E1018" stroke="#2A2D3A" strokeWidth={2}/>
      <circle cx={w * 0.08} cy={bh * 0.04} r={bh * 0.31} fill="#080A12" stroke="#1C1F2A" strokeWidth={1.5}/>
      <circle cx={w * 0.08} cy={bh * 0.04} r={bh * 0.19} fill={`url(#cs_${uid})`}/>
      <circle cx={w * 0.08} cy={bh * 0.04} r={bh * 0.08} fill="#040608"/>
      <ellipse cx={w * 0.02} cy={bh * -0.06} rx={bh * 0.08} ry={bh * 0.045} fill="white" opacity={0.22} transform={`rotate(-40,${w*0.02},${bh*-0.06})`}/>
      <rect x={-w * 0.32} y={-bh * 0.22} width={w * 0.18} height={bh * 0.17} rx={3} fill="#F0C040" opacity={0.78}/>
      <circle cx={-w * 0.28} cy={-bh * 0.32} r={bh * 0.17} fill="#252838"/>
      <circle cx={-w * 0.28} cy={-bh * 0.32} r={bh * 0.1} fill="#2E3245"/>
      <circle cx={-w * 0.08} cy={-bh * 0.32} r={bh * 0.13} fill="#202335"/>
      <circle cx={-w * 0.08} cy={-bh * 0.32} r={bh * 0.07} fill="#181A28"/>
      <defs>
        <radialGradient id={`cs_${uid}`} cx="38%" cy="34%" r="62%">
          <stop offset="0%"   stopColor="#1E3A6A"/>
          <stop offset="60%"  stopColor="#0E1A38"/>
          <stop offset="100%" stopColor="#040810"/>
        </radialGradient>
      </defs>
    </g>
  )
}

function KeyboardSVG({ w, h, uid }) {
  const r = 5
  const rows = [
    [0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92],
    [0.05, 0.18, 0.31, 0.44, 0.57, 0.70, 0.83, 0.96],
    [0.10, 0.23, 0.36, 0.49, 0.62, 0.75, 0.88],
    [0.15, 0.28, 0.41, 0.54, 0.67, 0.80],
  ]
  const kw = w * 0.115, kh = h * 0.2
  return (
    <g>
      <ellipse cx={0} cy={h/2 + 4} rx={w * 0.52} ry={5} fill="black" opacity={0.12}/>
      <rect x={-w/2} y={-h/2} width={w} height={h} rx={r} fill="#1e293b"/>
      <rect x={-w/2 + 3} y={-h/2 + 3} width={w - 6} height={h - 6} rx={r - 1} fill="#243044"/>
      {rows.flatMap((cols, ri) =>
        cols.map((cx, ci) => (
          <rect key={`${ri}-${ci}`}
            x={-w/2 + w * cx - kw/2} y={-h/2 + h * (0.14 + ri * 0.22) - kh/2}
            width={kw} height={kh} rx={1.5}
            fill="#2d3f58" stroke="#1a2a3e" strokeWidth={0.6}/>
        ))
      )}
      {/* Space bar */}
      <rect x={-w * 0.22} y={h * 0.28} width={w * 0.44} height={kh} rx={1.5} fill="#2d3f58" stroke="#1a2a3e" strokeWidth={0.6}/>
      <rect x={-w/2 + 3} y={-h/2 + 3} width={w - 6} height={4} rx={2} fill="white" opacity={0.04}/>
    </g>
  )
}

function MouseSVG({ w, h, uid }) {
  const bw = w * 0.78
  return (
    <g>
      <ellipse cx={0} cy={h * 0.38} rx={bw * 0.48} ry={6} fill="black" opacity={0.14}/>
      {/* Body shape */}
      <path d={`M${-bw/2} ${-h * 0.05} C${-bw/2} ${-h * 0.48} ${bw/2} ${-h * 0.48} ${bw/2} ${-h * 0.05} L${bw/2} ${h * 0.32} C${bw/2} ${h * 0.48} ${-bw/2} ${h * 0.48} ${-bw/2} ${h * 0.32} Z`}
        fill="#1e293b"/>
      <path d={`M${-bw/2 + 2} ${-h * 0.04} C${-bw/2 + 2} ${-h * 0.46} ${bw/2 - 2} ${-h * 0.46} ${bw/2 - 2} ${-h * 0.04} L${bw/2 - 2} ${h * 0.31} C${bw/2 - 2} ${h * 0.46} ${-bw/2 + 2} ${h * 0.46} ${-bw/2 + 2} ${h * 0.31} Z`}
        fill="#243044"/>
      {/* Center split */}
      <line x1={0} y1={-h * 0.46} x2={0} y2={h * 0.02} stroke="#1a2a3e" strokeWidth={1.5}/>
      {/* Left button */}
      <path d={`M${-bw/2 + 2} ${-h * 0.04} C${-bw/2 + 2} ${-h * 0.46} 0 ${-h * 0.46} 0 ${-h * 0.46} L0 ${h * 0.02} C${-bw/2 + 2} ${h * 0.02} ${-bw/2 + 2} ${-h * 0.04} Z`}
        fill="#2d3f58" opacity={0.7}/>
      {/* Scroll wheel */}
      <rect x={-w * 0.08} y={-h * 0.28} width={w * 0.16} height={h * 0.25} rx={w * 0.08} fill="#364a66"/>
      <rect x={-w * 0.05} y={-h * 0.22} width={w * 0.10} height={h * 0.14} rx={w * 0.05} fill="#4a6080" opacity={0.8}/>
      {/* Shine */}
      <ellipse cx={-bw * 0.2} cy={-h * 0.25} rx={bw * 0.15} ry={h * 0.08} fill="white" opacity={0.07} transform={`rotate(-15,${-bw*0.2},${-h*0.25})`}/>
    </g>
  )
}

const RENDERERS = { monitor: MonitorSVG, laptop: LaptopSVG, phone: PhoneSVG, ipad: IPadSVG, camera: CameraSVG, keyboard: KeyboardSVG, mouse: MouseSVG }

// Native dimensions (w x h) for each device type
const DEVICE_DIMS = {
  monitor:  { w: 130, h: 110 },
  laptop:   { w: 130, h: 95  },
  phone:    { w: 44,  h: 88  },
  ipad:     { w: 82,  h: 110 },
  camera:   { w: 84,  h: 60  },
  keyboard: { w: 140, h: 52  },
  mouse:    { w: 52,  h: 80  },
}

// ── Palette button ────────────────────────────────────────────────────────────
function PaletteBtn({ id, selected, onClick }) {
  const R = RENDERERS[id]
  const d = DEVICE_DIMS[id]
  const meta = DEVICE_META.find(m => m.id === id)
  const vScale = 0.28
  const vw = d.w * vScale + 8, vh = d.h * vScale + 8
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', width: '100%',
        background: selected ? '#1a2e4a' : 'transparent',
        border: `1.5px solid ${selected ? '#1a2e4a' : 'transparent'}`,
        borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 0.14s', textAlign: 'left',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.background = '#F0EDE8'; e.currentTarget.style.borderColor = '#EDEBE6' }}}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}}
    >
      <svg width={vw} height={vh} viewBox={`${-vw/2} ${-vh/2} ${vw} ${vh}`} overflow="visible" style={{ flexShrink: 0 }}>
        <g transform={`scale(${vScale})`}>
          <R w={d.w} h={d.h} uid={`pal_${id}`}/>
        </g>
      </svg>
      <span style={{ fontSize: 12, fontWeight: 600, color: selected ? '#fff' : '#374151', letterSpacing: '0.01em' }}>
        {meta?.label}
      </span>
    </button>
  )
}

// ── Resize handle ─────────────────────────────────────────────────────────────
function ResizeHandle({ x, y, onPointerDown }) {
  return (
    <g style={{ cursor: 'nwse-resize' }} onPointerDown={onPointerDown}>
      <rect x={x - 8} y={y - 8} width={16} height={16} fill="transparent"/>
      <rect x={x - 5} y={y - 5} width={10} height={10} rx={2}
        fill="white" stroke="#1a2e4a" strokeWidth={1.5} opacity={0.9}/>
    </g>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IsometricWorkspace({ devices, setDevices, onContinue }) {
  const [selectedDevice, setSelectedDevice] = useState(null) // type to add
  const [activeId,       setActiveId]       = useState(null) // selected placed device id
  const svgRef  = useRef(null)
  const dragRef = useRef(null) // { id, mode: 'move'|'resize', startSX, startSY, startCol, startRow, startScale }

  // Convert a PointerEvent to SVG coordinates
  const eventToSVG = useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = SVG_W / rect.width
    const scaleY = SVG_H / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    }
  }, [])

  // Check if SVG point is inside desk trapezoid
  function insideDesk(sx, sy) {
    const { col, row } = svgToDeskCoords(sx, sy)
    return col >= 0 && col <= 1 && row >= 0 && row <= 1
  }

  // Click on desk surface → place device
  const handleSVGClick = useCallback((e) => {
    if (dragRef.current?.moved) return // was a drag, not a click
    if (!selectedDevice) return
    const { x, y } = eventToSVG(e)
    if (!insideDesk(x, y)) return
    const { col, row } = svgToDeskCoords(x, y)
    const id = `${selectedDevice}_${Date.now()}`
    setDevices(prev => [...prev, { id, type: selectedDevice, col, row, scale: 1 }])
  }, [selectedDevice, eventToSVG, setDevices])

  // Pointer down on a device → start drag/resize
  const handleDevicePointerDown = useCallback((e, deviceId, mode) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const { x, y } = eventToSVG(e)
    const dev = devices.find(d => d.id === deviceId)
    if (!dev) return
    dragRef.current = {
      id: deviceId, mode,
      startSX: x, startSY: y,
      startCol: dev.col, startRow: dev.row,
      startScale: dev.scale,
      moved: false,
    }
    setActiveId(deviceId)
    setSelectedDevice(null)
    e.preventDefault()
  }, [devices, eventToSVG])

  // Pointer move → update position or scale
  const handlePointerMove = useCallback((e) => {
    const dr = dragRef.current
    if (!dr) return
    const { x, y } = eventToSVG(e)
    const dx = x - dr.startSX, dy = y - dr.startSY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dr.moved = true
    if (!dr.moved) return

    if (dr.mode === 'move') {
      const { col, row } = svgToDeskCoords(x, y)
      setDevices(prev => prev.map(d => d.id === dr.id ? { ...d, col: Math.max(0.04, Math.min(0.96, col)), row: Math.max(0.04, Math.min(0.96, row)) } : d))
    } else if (dr.mode === 'resize') {
      // dy upward (negative) = bigger; dy downward = smaller
      const factor = 1 - dy * 0.004
      const newScale = Math.max(0.4, Math.min(2.4, dr.startScale * factor))
      setDevices(prev => prev.map(d => d.id === dr.id ? { ...d, scale: newScale } : d))
    }
  }, [eventToSVG, setDevices])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const removeDevice = (id) => {
    setDevices(prev => prev.filter(d => d.id !== id))
    if (activeId === id) setActiveId(null)
  }

  // Sort devices by row so far devices render first (behind near ones)
  const sortedDevices = [...devices].sort((a, b) => b.row - a.row)

  const hasDevices = devices.length > 0

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: '#F5F4F0', fontFamily: 'inherit', userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '18px 28px 16px',
        background: '#FAFAF8',
        borderBottom: '1px solid #EDEBE6',
      }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 3px' }}>
            Advanced Setup
          </p>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
            {selectedDevice
              ? `Click the desk to place · drag to move · corner to resize`
              : activeId
              ? `Selected — drag to reposition or resize`
              : 'Select a device from the panel'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {activeId && (
            <button onClick={() => removeDevice(activeId)} style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 600,
              background: 'transparent', color: '#ef4444',
              border: '1px solid #fca5a5', borderRadius: 100,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}>Remove</button>
          )}
          <button onClick={onContinue} style={{
            padding: '9px 24px', fontSize: 13, fontWeight: 700,
            background: '#1a2e4a', color: '#fff',
            border: 'none', borderRadius: 100, cursor: 'pointer',
            fontFamily: 'inherit', letterSpacing: '0.01em',
            boxShadow: '0 2px 10px rgba(26,46,74,0.25)',
            transition: 'opacity 0.15s',
          }}>
            {hasDevices ? 'Save' : 'Skip'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1 }}>

        {/* SVG scene */}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px 8px 28px',
        }}>
          <svg
            ref={svgRef}
            width={SVG_W} height={SVG_H}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ overflow: 'visible', maxWidth: '100%', cursor: selectedDevice ? 'crosshair' : 'default' }}
            onClick={handleSVGClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <defs>
              <linearGradient id="deskSurface" x1="20%" y1="0%" x2="80%" y2="100%">
                <stop offset="0%"   stopColor="#EDE5D0"/>
                <stop offset="35%"  stopColor="#E0D4BB"/>
                <stop offset="70%"  stopColor="#D4C4A4"/>
                <stop offset="100%" stopColor="#C8B898"/>
              </linearGradient>
              <linearGradient id="deskFrontEdge" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#B0A080"/>
                <stop offset="100%" stopColor="#8C7A60"/>
              </linearGradient>
              <linearGradient id="floorGrad" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%"   stopColor="#D8D2C4"/>
                <stop offset="100%" stopColor="#C0B8A8"/>
              </linearGradient>
              <radialGradient id="deskVig" cx="50%" cy="55%" r="55%">
                <stop offset="0%"   stopColor="transparent"/>
                <stop offset="100%" stopColor="rgba(0,0,0,0.07)"/>
              </radialGradient>
              <pattern id="woodGrain" x="0" y="0" width="60" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-3)">
                <line x1="0" y1="3"  x2="60" y2="3"  stroke="rgba(80,55,20,0.04)" strokeWidth="1.2"/>
                <line x1="0" y1="7"  x2="60" y2="7"  stroke="rgba(80,55,20,0.025)" strokeWidth="0.7"/>
                <line x1="0" y1="10" x2="60" y2="10" stroke="rgba(80,55,20,0.02)" strokeWidth="0.5"/>
              </pattern>
              <filter id="deviceShadow">
                <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#00000020"/>
              </filter>
            </defs>

            {/* Floor */}
            <rect x={0} y={NEAR_Y + 14} width={SVG_W} height={80} fill="url(#floorGrad)"/>
            {/* Floor/desk seam shadow */}
            <rect x={NEAR_L - 20} y={NEAR_Y + 12} width={NEAR_R - NEAR_L + 40} height={8} fill="black" opacity={0.05} style={{filter:'blur(4px)'}}/>

            {/* Desk legs (near visible, far dimmed) */}
            {[
              { x: NEAR_L + 24,       y: NEAR_Y,     h: 56, opacity: 1   },
              { x: NEAR_R - 24 - 14,  y: NEAR_Y,     h: 56, opacity: 1   },
              { x: FAR_L + 14,        y: FAR_Y + 10, h: 26, opacity: 0.4 },
              { x: FAR_R - 14 - 10,   y: FAR_Y + 10, h: 26, opacity: 0.4 },
            ].map((leg, i) => (
              <g key={i} opacity={leg.opacity}>
                <rect x={leg.x} y={leg.y} width={14} height={leg.h + 8} rx={3}
                  fill={i < 2 ? '#282828' : '#202020'}/>
                {i < 2 && <rect x={leg.x - 4} y={leg.y + leg.h + 4} width={22} height={8} rx={2} fill="#181818"/>}
              </g>
            ))}

            {/* Desk surface */}
            <polygon
              points={`${FAR_L},${FAR_Y} ${FAR_R},${FAR_Y} ${NEAR_R},${NEAR_Y} ${NEAR_L},${NEAR_Y}`}
              fill="url(#deskSurface)"
            />
            <polygon
              points={`${FAR_L},${FAR_Y} ${FAR_R},${FAR_Y} ${NEAR_R},${NEAR_Y} ${NEAR_L},${NEAR_Y}`}
              fill="url(#woodGrain)" opacity={0.9}
            />
            <polygon
              points={`${FAR_L},${FAR_Y} ${FAR_R},${FAR_Y} ${NEAR_R},${NEAR_Y} ${NEAR_L},${NEAR_Y}`}
              fill="url(#deskVig)"
            />
            {/* Front edge */}
            <polygon
              points={`${NEAR_L},${NEAR_Y} ${NEAR_R},${NEAR_Y} ${NEAR_R + 10},${NEAR_Y + 16} ${NEAR_L - 10},${NEAR_Y + 16}`}
              fill="url(#deskFrontEdge)"
            />
            <line x1={NEAR_L} y1={NEAR_Y} x2={NEAR_R} y2={NEAR_Y} stroke="white" strokeWidth={1.5} opacity={0.28}/>
            <line x1={FAR_L}  y1={FAR_Y}  x2={FAR_R}  y2={FAR_Y}  stroke="white" strokeWidth={0.8} opacity={0.12}/>

            {/* Placed devices — sorted far→near so near devices render on top */}
            {sortedDevices.map(dev => {
              const { x, y } = deskToSVG(dev.col, dev.row)
              const ds = depthScale(dev.row) * dev.scale
              const R  = RENDERERS[dev.type]
              const d  = DEVICE_DIMS[dev.type]
              const dw = d.w * ds, dh = d.h * ds
              const isActive = activeId === dev.id
              const handleX = dw / 2 + 2, handleY = dh / 2 + 2
              return (
                <g
                  key={dev.id}
                  transform={`translate(${x}, ${y})`}
                  filter="url(#deviceShadow)"
                  style={{ cursor: 'grab' }}
                  onPointerDown={e => handleDevicePointerDown(e, dev.id, 'move')}
                >
                  <g transform={`scale(${ds})`}>
                    <R w={d.w} h={d.h} uid={dev.id}/>
                  </g>
                  {/* Selection ring */}
                  {isActive && (
                    <rect
                      x={-dw/2 - 5} y={-dh/2 - 5}
                      width={dw + 10} height={dh + 10}
                      rx={8} fill="none"
                      stroke="#1a2e4a" strokeWidth={1.5}
                      strokeDasharray="5,3" opacity={0.7}
                    />
                  )}
                  {/* Resize handle */}
                  {isActive && (
                    <ResizeHandle
                      x={handleX} y={handleY}
                      onPointerDown={e => handleDevicePointerDown(e, dev.id, 'resize')}
                    />
                  )}
                </g>
              )
            })}

            {/* "You" indicator */}
            <g transform={`translate(${SVG_W / 2}, ${SVG_H - 14})`}>
              <rect x={-44} y={-11} width={88} height={22} rx={11} fill="#1a2e4a18"/>
              <text textAnchor="middle" dominantBaseline="middle"
                fontSize={9.5} fontWeight="800" fill="#1a2e4a70"
                letterSpacing="0.1em">
                ↑ YOU ARE HERE
              </text>
            </g>
          </svg>
        </div>

        {/* Sidebar */}
        <div style={{
          width: 172, display: 'flex', flexDirection: 'column',
          padding: '20px 12px 20px',
          background: '#FAFAF8', borderLeft: '1px solid #EDEBE6',
          overflowY: 'auto',
          gap: 4,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            margin: '0 4px 10px',
          }}>
            Devices
          </p>

          {DEVICE_META.map(d => (
            <PaletteBtn
              key={d.id} id={d.id}
              selected={selectedDevice === d.id}
              onClick={() => { setSelectedDevice(prev => prev === d.id ? null : d.id); setActiveId(null) }}
            />
          ))}

          {hasDevices && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #EDEBE6' }}>
              <p style={{
                fontSize: 10, fontWeight: 700, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                margin: '0 4px 8px',
              }}>On desk</p>
              {devices.map(d => {
                const meta = DEVICE_META.find(m => m.id === d.type)
                const isActive = d.id === activeId
                return (
                  <div
                    key={d.id}
                    onClick={() => setActiveId(isActive ? null : d.id)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                      background: isActive ? '#1a2e4a' : 'transparent',
                      transition: 'background 0.15s',
                      marginBottom: 2,
                    }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#fff' : '#374151' }}>
                      {meta?.label}
                    </span>
                    <span style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,0.5)' : '#9ca3af' }}>
                      {Math.round(d.scale * 100)}%
                    </span>
                  </div>
                )
              })}
              <button
                onClick={() => { setDevices([]); setActiveId(null) }}
                style={{
                  marginTop: 8, width: '100%', padding: '7px',
                  fontSize: 11, fontWeight: 500, color: '#9ca3af',
                  background: 'none', border: '1px solid #EDEBE6',
                  borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'color 0.15s, border-color 0.15s',
                }}>
                Clear all
              </button>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <p style={{ fontSize: 10, color: '#C8C4BA', lineHeight: 1.6, textAlign: 'center' }}>
              Click to place<br/>Drag to move<br/>Corner to resize
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
