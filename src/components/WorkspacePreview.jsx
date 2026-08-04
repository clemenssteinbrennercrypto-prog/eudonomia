import {
  defaultRoleForType,
  isProductiveDownwardRole,
  isScreenRole,
  normalizeWorkspaceObjects,
} from '../lib/workspaceObjects'

const navy = '#2C46FF'
const green = '#2f855a'
const amber = '#c47f1a'
const red = '#c2413b'

const desk = { x: 50, y: 34, width: 300, height: 160 }
const user = { x: 200, y: 235 }

function devicePoint(device) {
  return {
    x: desk.x + 32 + (device.col ?? 0.5) * (desk.width - 64),
    y: desk.y + 26 + (device.row ?? 0.5) * (desk.height - 52),
  }
}

function polarPoint(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: user.x + Math.cos(rad) * radius,
    y: user.y + Math.sin(rad) * radius,
  }
}

function fanPath(leftAngle, rightAngle, radius) {
  const left = polarPoint(leftAngle, radius)
  const right = polarPoint(rightAngle, radius)
  return `M ${user.x} ${user.y} L ${left.x} ${left.y} A ${radius} ${radius} 0 0 1 ${right.x} ${right.y} Z`
}

function productiveFanPath(screenDevices) {
  if (!screenDevices.length) return fanPath(-128, -52, 218)

  const angles = screenDevices.map(device => {
    const point = devicePoint(device)
    return Math.atan2(point.y - user.y, point.x - user.x) * 180 / Math.PI
  })
  const left = Math.min(...angles) - 22
  const right = Math.max(...angles) + 22
  return fanPath(Math.max(-160, left), Math.min(-20, right), 222)
}

function DeviceIcon({ type, x, y }) {
  const stroke = navy
  const fill = '#fff'

  if (type === 'monitor') {
    return (
      <g transform={`translate(${x - 18} ${y - 13})`}>
        <rect x="0" y="0" width="36" height="23" rx="3" fill={fill} stroke={stroke} strokeWidth="2" />
        <line x1="7" y1="17" x2="29" y2="17" stroke={stroke} strokeWidth="1.5" />
        <line x1="18" y1="23" x2="18" y2="29" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        <line x1="11" y1="29" x2="25" y2="29" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      </g>
    )
  }

  if (type === 'laptop') {
    return (
      <g transform={`translate(${x - 20} ${y - 12})`}>
        <rect x="5" y="0" width="30" height="20" rx="3" fill={fill} stroke={stroke} strokeWidth="2" />
        <path d="M2 24 L38 24 L34 20 L6 20 Z" fill="#1B2450" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      </g>
    )
  }

  if (type === 'camera') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle cx="0" cy="0" r="13" fill="#141C42" stroke={stroke} strokeWidth="2" />
        <circle cx="0" cy="0" r="5" fill="none" stroke={stroke} strokeWidth="2" />
        <circle cx="4" cy="-4" r="2" fill={stroke} />
      </g>
    )
  }

  if (type === 'phone') {
    return (
      <g transform={`translate(${x - 8} ${y - 17})`}>
        <rect x="0" y="0" width="16" height="34" rx="4" fill={fill} stroke={stroke} strokeWidth="2" />
        <circle cx="8" cy="29" r="1.5" fill={stroke} />
      </g>
    )
  }

  if (type === 'paper' || type === 'notebook') {
    return (
      <g transform={`translate(${x - 15} ${y - 17})`}>
        <rect x="0" y="0" width="30" height="34" rx="2" fill={fill} stroke={stroke} strokeWidth="2" />
        <line x1="6" y1="10" x2="24" y2="10" stroke="#9EAAD9" strokeWidth="1.5" />
        <line x1="6" y1="17" x2="22" y2="17" stroke="#9EAAD9" strokeWidth="1.5" />
      </g>
    )
  }

  return (
    <g transform={`translate(${x - 14} ${y - 14})`}>
      <rect x="0" y="0" width="28" height="28" rx="5" fill={fill} stroke={stroke} strokeWidth="2" />
    </g>
  )
}

function deviceLabel(type) {
  if (type === 'camera') return 'Camera'
  if (type === 'laptop') return 'Laptop'
  if (type === 'monitor') return 'Monitor'
  if (type === 'phone') return 'Phone'
  if (type === 'notebook') return 'Notebook'
  if (type === 'paper') return 'Paper'
  return 'Device'
}

function directionFor(device) {
  const col = device.col ?? 0.5
  if (col < 0.45) return 'left'
  if (col > 0.55) return 'right'
  return 'center'
}

function buildSummary(devices) {
  const screens = devices.filter(device => isScreenRole(device.role || defaultRoleForType(device.type)))
  const laptops = screens.filter(device => device.type === 'laptop')
  const monitors = screens.filter(device => device.type === 'monitor')
  const cameras = devices.filter(device => device.type === 'camera')
  const sideScreens = screens.filter(device => (device.col ?? 0.5) < 0.45 || (device.col ?? 0.5) > 0.55)
  const hasLaptop = laptops.length > 0
  const downwardProductive = devices.some(device =>
    isProductiveDownwardRole(device.role || defaultRoleForType(device.type)) && (device.row ?? 0.5) <= 0.58
  )
  const hasPhone = devices.some(device => device.type === 'phone' || device.role === 'distraction_device')

  const mainScreen = laptops.length && monitors.length
    ? 'Main screen: laptop and monitor are treated as productive.'
    : laptops.length
      ? 'Main screen: laptop gaze is treated as productive.'
      : monitors.length
        ? 'Main screen: monitor gaze is treated as productive.'
        : 'Main screen: no screen configured, so gaze zones stay conservative.'

  const sideText = sideScreens.length
    ? `Side screens: ${sideScreens.map(directionFor).join(' and ')} gaze is allowed.`
    : 'Side screens: none configured, so far-left and far-right gaze become ambiguous.'

  const camera = cameras[0]
  const cameraText = camera
    ? `Camera position: ${directionFor(camera)}${(camera.row ?? 0) > 0.55 ? ', low angle' : (camera.row ?? 0) < 0 ? ', high angle' : ''}.`
    : 'Camera position: not configured.'

  const downText = hasLaptop
    ? 'Head-down tolerance: more lenient because laptop posture naturally points downward.'
    : 'Head-down tolerance: stricter because no laptop screen is configured.'

  const phoneText = hasPhone || !downwardProductive
    ? 'Phone zone: active for steep downward gaze away from configured work objects.'
    : 'Phone zone: softened where desk objects are configured as productive.'

  return [mainScreen, sideText, cameraText, downText, phoneText]
}

function statusColor(status) {
  if (status === 'green') return green
  if (status === 'red') return red
  return amber
}

function StatusIcon({ status }) {
  const color = statusColor(status)
  if (status === 'red') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    )
  }
  if (status === 'amber') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l9 16H3L12 3z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  )
}

function buildAccuracyChecks(devices) {
  const mainScreen = devices.some(device => (device.role || defaultRoleForType(device.type)) === 'primary_screen')
  const camera = devices.find(device => device.type === 'camera')
  const secondaryScreens = devices.filter(device => (device.role || defaultRoleForType(device.type)) === 'secondary_screen')
  const hasOverlaps = devices.some((device, index) =>
    devices.slice(index + 1).some(other =>
      Math.abs((device.col ?? 0.5) - (other.col ?? 0.5)) <= 0.05 &&
      Math.abs((device.row ?? 0.5) - (other.row ?? 0.5)) <= 0.05
    )
  )
  const cameraCol = camera?.col ?? 0.5
  const sideScreensReasonable = secondaryScreens.every(device => {
    const col = device.col ?? 0.5
    return col < 0.45 || col > 0.55
  })

  return [
    {
      key: 'main-screen',
      label: 'Main screen configured',
      status: mainScreen ? 'green' : 'red',
      detail: mainScreen ? 'Primary focus target is set.' : 'Add a primary laptop or monitor.',
    },
    {
      key: 'camera-configured',
      label: 'Camera configured',
      status: camera ? 'green' : 'red',
      detail: camera ? 'Camera angle can adjust tracking.' : 'Add your webcam position.',
    },
    {
      key: 'camera-position',
      label: 'Camera position reasonable',
      status: !camera || cameraCol < 0.2 || cameraCol > 0.8 ? 'amber' : 'green',
      detail: !camera
        ? 'Camera position cannot be checked yet.'
        : cameraCol < 0.2 || cameraCol > 0.8
          ? 'Side cameras can make yaw calibration less stable.'
          : 'Camera is not at an extreme side angle.',
    },
    {
      key: 'side-monitors',
      label: 'Side monitors are clear',
      status: sideScreensReasonable ? 'green' : 'amber',
      detail: secondaryScreens.length
        ? 'Side screens are far enough from center.'
        : 'No side monitors configured.',
    },
    {
      key: 'overlaps',
      label: 'No overlapping devices',
      status: hasOverlaps ? 'amber' : 'green',
      detail: hasOverlaps ? 'Move stacked devices apart for cleaner zones.' : 'Device positions are distinct.',
    },
  ]
}

function LegendItem({ color, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {children}
    </span>
  )
}

export default function WorkspacePreview({ devices, onConfirm, onEditSetup, onFineTune }) {
  const workspaceDevices = normalizeWorkspaceObjects(devices)
  const screens = workspaceDevices.filter(device => isScreenRole(device.role || defaultRoleForType(device.type)))
  const summary = buildSummary(workspaceDevices)
  const accuracyChecks = buildAccuracyChecks(workspaceDevices)
  const greenCount = accuracyChecks.filter(check => check.status === 'green').length
  const accuracyScore = Math.round((greenCount / accuracyChecks.length) * 100)
  const accuracyMessage = greenCount === accuracyChecks.length
    ? 'Great setup — tracking should be accurate'
    : greenCount >= 3
      ? 'Good setup — minor improvements possible'
      : 'Setup incomplete — tracking may be unreliable'

  return (
    <div style={{
      minHeight: '100vh',
      background: '#070B1A',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '36px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
      color: navy,
    }}>
      <section style={{
        width: '100%',
        maxWidth: 560,
        background: 'var(--surface)',
        border: '1px solid rgba(122,152,255,0.15)',
        borderRadius: 20,
        padding: '30px 28px',
        boxShadow: '0 2px 24px rgba(0,0,0,0.07)',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}>
        <div>
          <p style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#9CA3AF',
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            margin: '0 0 8px',
          }}>
            Workspace preview
          </p>
          <h2 style={{
            fontSize: 25,
            lineHeight: 1.15,
            fontWeight: 750,
            letterSpacing: 0,
            color: 'var(--text)',
            margin: 0,
          }}>
            How Eudaimonia reads your desk
          </h2>
        </div>

        <svg
          viewBox="0 0 400 260"
          role="img"
          aria-label="Top-down workspace preview with productive, ambiguous, and distraction gaze zones"
          style={{
            width: '100%',
            maxWidth: 420,
            alignSelf: 'center',
            display: 'block',
          }}
        >
          <defs>
            <clipPath id="deskClip">
              <rect x={desk.x} y={desk.y} width={desk.width} height={desk.height} rx="20" />
            </clipPath>
          </defs>

          <rect x={desk.x} y={desk.y} width={desk.width} height={desk.height} rx="20" fill="#0D1330" stroke="#d8d0c4" strokeWidth="2" />

          <g clipPath="url(#deskClip)">
            <path d={fanPath(-160, -116, 225)} fill={amber} opacity="0.18" />
            <path d={fanPath(-64, -20, 225)} fill={amber} opacity="0.18" />
            <path d={productiveFanPath(screens)} fill={green} opacity="0.24" />
            <path d="M50 142 H350 V194 H50 Z" fill={red} opacity="0.14" />
          </g>

          <path d="M80 194 Q200 214 320 194" fill="none" stroke={red} strokeWidth="2" strokeDasharray="5 7" opacity="0.55" />
          <path d="M116 67 Q200 35 284 67" fill="none" stroke={green} strokeWidth="2" strokeDasharray="5 7" opacity="0.65" />

          {workspaceDevices.map((device, index) => {
            const base = devicePoint(device)
            const offset = workspaceDevices
              .slice(0, index)
              .filter(prev => Math.abs((prev.col ?? 0.5) - (device.col ?? 0.5)) < 0.02 && Math.abs((prev.row ?? 0.5) - (device.row ?? 0.5)) < 0.02)
              .length * 18
            const x = base.x + offset
            const y = base.y + offset * 0.3
            return (
              <g key={device.id || `${device.type}-${index}`}>
                <DeviceIcon type={device.type} x={x} y={y} />
                <text x={x} y={y + 30} textAnchor="middle" fontSize="10" fontWeight="700" fill={navy} opacity="0.7">
                  {deviceLabel(device.type)}
                </text>
              </g>
            )
          })}

          <g transform={`translate(${user.x} ${user.y})`}>
            <circle cx="0" cy="-10" r="12" fill={navy} opacity="0.95" />
            <path d="M-22 18 Q0 -2 22 18" fill={navy} opacity="0.95" />
            <text x="0" y="20" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">You</text>
          </g>
        </svg>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 16px',
          fontSize: 12,
          fontWeight: 650,
          color: 'var(--text-secondary)',
          padding: '12px 14px',
          background: '#070B1A',
          borderRadius: 12,
        }}>
          <LegendItem color={green}>Productive gaze</LegendItem>
          <LegendItem color={amber}>Ambiguous</LegendItem>
          <LegendItem color={red}>Distraction zone</LegendItem>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
            <svg width="15" height="15" viewBox="-15 -15 30 30" aria-hidden="true">
              <circle cx="0" cy="0" r="12" fill="#141C42" stroke={navy} strokeWidth="3" />
              <circle cx="0" cy="0" r="5" fill="none" stroke={navy} strokeWidth="3" />
            </svg>
            Camera position
          </span>
        </div>

        <ul style={{
          margin: 0,
          paddingLeft: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: 'var(--text-secondary)',
          fontSize: 14,
          lineHeight: 1.45,
        }}>
          {summary.map(item => <li key={item}>{item}</li>)}
        </ul>

        <div style={{
          border: '1px solid rgba(122,152,255,0.15)',
          borderRadius: 16,
          padding: '16px 16px 14px',
          background: '#0A1028',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)', letterSpacing: 0 }}>
                Setup accuracy
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#5F6C9C', lineHeight: 1.35 }}>
                {accuracyMessage}
              </p>
            </div>
            <div style={{
              minWidth: 72,
              textAlign: 'right',
              fontSize: 24,
              fontWeight: 800,
              color: statusColor(greenCount === accuracyChecks.length ? 'green' : greenCount >= 3 ? 'amber' : 'red'),
              lineHeight: 1,
            }}>
              {accuracyScore}%
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {accuracyChecks.map(check => (
              <div key={check.key} style={{
                display: 'grid',
                gridTemplateColumns: '22px 1fr',
                gap: 8,
                alignItems: 'flex-start',
                color: 'var(--text-secondary)',
              }}>
                <StatusIcon status={check.status} />
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {check.label}
                  </p>
                  {check.status !== 'green' && (
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#5F6C9C', lineHeight: 1.35 }}>
                      {check.detail}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: '1 1 210px',
              minHeight: 54,
              border: 'none',
              borderRadius: 14,
              background: navy,
              color: '#fff',
              fontFamily: 'inherit',
              fontSize: 16,
              fontWeight: 750,
              cursor: 'pointer',
            }}
          >
            Looks good — start
          </button>
          <button
            type="button"
            onClick={onEditSetup}
            style={{
              flex: '1 1 150px',
              minHeight: 54,
              border: '1.5px solid rgba(122,152,255,0.15)',
              borderRadius: 14,
              background: 'var(--surface)',
              color: navy,
              fontFamily: 'inherit',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Edit setup
          </button>
          <button
            type="button"
            onClick={onFineTune}
            style={{
              flex: '1 1 100%',
              minHeight: 46,
              border: 'none',
              background: 'transparent',
              color: '#5F6C9C',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Fine-tune in 3D →
          </button>
        </div>
      </section>
    </div>
  )
}
