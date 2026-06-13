// ── Professional SVG Device Illustrations ─────────────────────────────────────
// Each device renders as a clean 3D-style SVG icon

export function MonitorIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Screen body */}
      <rect x="4" y="6" width="56" height="38" rx="4" fill="#1e293b" />
      <rect x="6" y="8" width="52" height="34" rx="3" fill="#0f172a" />
      {/* Screen glow */}
      <rect x="8" y="10" width="48" height="30" rx="2" fill="#1e40af" opacity="0.15" />
      <rect x="8" y="10" width="48" height="30" rx="2" fill="url(#screenGrad)" />
      {/* Screen content lines */}
      <rect x="14" y="17" width="22" height="2" rx="1" fill="white" opacity="0.25" />
      <rect x="14" y="21" width="16" height="1.5" rx="0.75" fill="white" opacity="0.15" />
      <rect x="14" y="24" width="20" height="1.5" rx="0.75" fill="white" opacity="0.15" />
      {/* Stand neck */}
      <rect x="28" y="44" width="8" height="8" rx="1" fill="#334155" />
      {/* Stand base */}
      <rect x="20" y="51" width="24" height="5" rx="2.5" fill="#334155" />
      {/* Bezel shine */}
      <rect x="6" y="8" width="52" height="2" rx="1" fill="white" opacity="0.06" />
      <defs>
        <linearGradient id="screenGrad" x1="8" y1="10" x2="56" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function LaptopIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Screen lid */}
      <rect x="8" y="8" width="48" height="32" rx="3" fill="#1e293b" />
      <rect x="10" y="10" width="44" height="28" rx="2" fill="#0f172a" />
      {/* Screen content */}
      <rect x="12" y="12" width="40" height="24" rx="1.5" fill="url(#laptopScreen)" />
      <rect x="17" y="18" width="18" height="1.5" rx="0.75" fill="white" opacity="0.2" />
      <rect x="17" y="21" width="13" height="1.5" rx="0.75" fill="white" opacity="0.15" />
      <rect x="17" y="24" width="16" height="1.5" rx="0.75" fill="white" opacity="0.15" />
      {/* Apple-style camera dot */}
      <circle cx="32" cy="11" r="1" fill="#334155" />
      {/* Base / keyboard */}
      <path d="M6 40 L58 40 L56 52 L8 52 Z" fill="#334155" rx="2" />
      <path d="M6 40 L58 40 L56 52 L8 52 Z" fill="url(#baseGrad)" />
      {/* Keyboard rows */}
      {[44, 47].map((y, i) => (
        <g key={i}>
          {[10, 15, 20, 25, 30, 35, 40, 45, 50].map(x => (
            <rect key={x} x={x} y={y} width="3" height="1.5" rx="0.5" fill="white" opacity="0.08" />
          ))}
        </g>
      ))}
      {/* Trackpad */}
      <rect x="26" y="48.5" width="12" height="7" rx="1.5" fill="#475569" opacity="0.5" />
      <rect x="8" y="40" width="48" height="1" rx="0.5" fill="white" opacity="0.05" />
      <defs>
        <linearGradient id="laptopScreen" x1="12" y1="12" x2="52" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="baseGrad" x1="6" y1="40" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.04" />
          <stop offset="100%" stopColor="black" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function PhoneIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Body */}
      <rect x="16" y="4" width="32" height="56" rx="7" fill="#1e293b" />
      <rect x="18" y="6" width="28" height="52" rx="6" fill="#0f172a" />
      {/* Screen */}
      <rect x="19" y="10" width="26" height="42" rx="4" fill="url(#phoneScreen)" />
      {/* Dynamic Island */}
      <rect x="27" y="12" width="10" height="3.5" rx="1.75" fill="#0f172a" />
      {/* Home indicator */}
      <rect x="27" y="49" width="10" height="2" rx="1" fill="#334155" />
      {/* Side buttons */}
      <rect x="14" y="20" width="2" height="6" rx="1" fill="#334155" />
      <rect x="14" y="28" width="2" height="6" rx="1" fill="#334155" />
      <rect x="48" y="22" width="2" height="10" rx="1" fill="#334155" />
      {/* Screen content */}
      <rect x="22" y="20" width="20" height="14" rx="3" fill="white" opacity="0.05" />
      <rect x="22" y="36" width="9" height="9" rx="2" fill="white" opacity="0.04" />
      <rect x="33" y="36" width="9" height="9" rx="2" fill="white" opacity="0.04" />
      <defs>
        <linearGradient id="phoneScreen" x1="19" y1="10" x2="45" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e40af" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function IPadIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Body */}
      <rect x="8" y="4" width="48" height="56" rx="6" fill="#1e293b" />
      <rect x="10" y="6" width="44" height="52" rx="5" fill="#0f172a" />
      {/* Screen */}
      <rect x="12" y="9" width="40" height="46" rx="3" fill="url(#ipadScreen)" />
      {/* Camera dot */}
      <circle cx="32" cy="7.5" r="1.2" fill="#334155" />
      {/* Home button (older iPad style) */}
      <circle cx="32" cy="57" r="2.5" fill="#1e293b" />
      <circle cx="32" cy="57" r="1.5" fill="#334155" />
      {/* Screen content */}
      <rect x="15" y="14" width="34" height="20" rx="2" fill="white" opacity="0.05" />
      <rect x="15" y="37" width="10" height="10" rx="2" fill="white" opacity="0.04" />
      <rect x="27" y="37" width="10" height="10" rx="2" fill="white" opacity="0.04" />
      <rect x="39" y="37" width="10" height="10" rx="2" fill="white" opacity="0.04" />
      <defs>
        <linearGradient id="ipadScreen" x1="12" y1="9" x2="52" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e40af" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#0f172a" stopOpacity="0.8" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function CameraIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Body */}
      <rect x="6" y="18" width="52" height="34" rx="6" fill="#1e293b" />
      {/* Grip texture */}
      <rect x="6" y="18" width="10" height="34" rx="5" fill="#151e2d" />
      {/* Shutter bump */}
      <rect x="28" y="13" width="16" height="8" rx="3" fill="#1e293b" />
      {/* Lens outer ring */}
      <circle cx="32" cy="35" r="14" fill="#0f172a" />
      <circle cx="32" cy="35" r="12" fill="#111827" />
      {/* Lens rings */}
      <circle cx="32" cy="35" r="11" fill="none" stroke="#1e293b" strokeWidth="1.5" />
      <circle cx="32" cy="35" r="9" fill="none" stroke="#1e293b" strokeWidth="1" />
      {/* Lens glass */}
      <circle cx="32" cy="35" r="7.5" fill="url(#lensGrad)" />
      {/* Lens reflection */}
      <ellipse cx="29" cy="32" rx="2.5" ry="1.5" fill="white" opacity="0.15" transform="rotate(-30 29 32)" />
      {/* Flash */}
      <rect x="46" y="22" width="7" height="5" rx="2" fill="#fbbf24" opacity="0.7" />
      {/* Viewfinder */}
      <rect x="46" y="29" width="7" height="5" rx="1.5" fill="#334155" />
      {/* Top dial */}
      <circle cx="18" cy="18" r="4" fill="#334155" />
      <circle cx="18" cy="18" r="2" fill="#475569" />
      <defs>
        <radialGradient id="lensGrad" cx="45%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#1e3a5f" />
          <stop offset="40%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
    </svg>
  )
}

export function KeyboardIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      <rect x="4" y="16" width="56" height="32" rx="5" fill="#1e293b"/>
      <rect x="6" y="18" width="52" height="28" rx="4" fill="#243044"/>
      {/* Key rows */}
      {[22, 28, 34, 40].map((y, row) => (
        [8, 14, 20, 26, 32, 38, 44, 50].slice(0, 8 - row).map(x => (
          <rect key={`${y}-${x}`} x={x} y={y} width={4} height={4} rx={1} fill="#2d3f58" stroke="#1a2a3e" strokeWidth={0.5}/>
        ))
      ))}
      {/* Space bar */}
      <rect x="18" y="40" width="28" height="4" rx="1.5" fill="#2d3f58" stroke="#1a2a3e" strokeWidth={0.5}/>
      {/* Shine */}
      <rect x="6" y="18" width="52" height="3" rx="2" fill="white" opacity={0.05}/>
    </svg>
  )
}

export function MouseIcon({ size = 64, dimmed = false }) {
  const op = dimmed ? 0.35 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity: op }}>
      {/* Body */}
      <path d="M20 28 C20 18 44 18 44 28 L44 46 C44 54 20 54 20 46 Z" fill="#1e293b"/>
      <path d="M21.5 29 C21.5 20 42.5 20 42.5 29 L42.5 45 C42.5 52.5 21.5 52.5 21.5 45 Z" fill="#243044"/>
      {/* Center divider */}
      <line x1="32" y1="20" x2="32" y2="36" stroke="#1a2a3e" strokeWidth="1.5"/>
      {/* Left button highlight */}
      <path d="M21.5 29 C21.5 20 32 20 32 20 L32 36 C28 36 21.5 34 21.5 29Z" fill="#2d3f58" opacity="0.6"/>
      {/* Scroll wheel */}
      <rect x="29" y="22" width="6" height="10" rx="3" fill="#364a66"/>
      <rect x="30.5" y="24" width="3" height="6" rx="1.5" fill="#4a6080" opacity="0.8"/>
      {/* Shine */}
      <ellipse cx="27" cy="25" rx="4" ry="2.5" fill="white" opacity="0.06" transform="rotate(-15 27 25)"/>
    </svg>
  )
}

export const DEVICE_ICON_MAP = {
  monitor:  MonitorIcon,
  laptop:   LaptopIcon,
  phone:    PhoneIcon,
  ipad:     IPadIcon,
  camera:   CameraIcon,
  keyboard: KeyboardIcon,
  mouse:    MouseIcon,
}
