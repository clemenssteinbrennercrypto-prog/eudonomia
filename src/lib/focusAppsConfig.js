export const PRESET_DOMAIN_MAP = {
  youtube: 'youtube.com',
  instagram: 'instagram.com',
  'twitter/x': 'x.com',
  twitter: 'twitter.com',
  x: 'x.com',
  tiktok: 'tiktok.com',
  reddit: 'reddit.com',
  netflix: 'netflix.com',
  facebook: 'facebook.com',
  snapchat: 'snapchat.com',
  notion: 'notion.so',
  figma: 'figma.com',
}

const PRESET_DOMAIN_ALIASES = {
  'twitter/x': ['x.com', 'twitter.com'],
  twitter: ['twitter.com', 'x.com'],
}

export function presetKey(appName) {
  return String(appName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function getDomainsFromAppPreset(appName) {
  const key = presetKey(appName)
  if (PRESET_DOMAIN_ALIASES[key]) return PRESET_DOMAIN_ALIASES[key]
  const domain = PRESET_DOMAIN_MAP[key]
  return domain ? [domain] : []
}

export function getDomainFromAppPreset(appName) {
  return getDomainsFromAppPreset(appName)[0] ?? null
}
