import { getDomainsFromAppPreset } from './focusAppsConfig'

export const PROTECTION_SETUP_SCHEMA_VERSION = 1
export const DEFAULT_PROTECTION_SETUP_ID = 'default'
export const DEFAULT_PROTECTION_SETUP_NAME = 'Deep Work'

export function normalizeProtectionAppList(apps) {
  if (!Array.isArray(apps)) return []
  const seen = new Set()
  return apps
    .map(app => String(app || '').trim())
    .filter(Boolean)
    .filter(app => {
      const key = app.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function normalizeProtectionDomain(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .trim()
  }
}

export function normalizeProtectionDomainList(domains) {
  if (!Array.isArray(domains)) return []
  const seen = new Set()
  return domains
    .map(normalizeProtectionDomain)
    .filter(Boolean)
    .filter(domain => {
      if (seen.has(domain)) return false
      seen.add(domain)
      return true
    })
}

function deriveDomainsFromApps(apps) {
  return apps.flatMap(app => {
    const presetDomains = getDomainsFromAppPreset(app)
    if (presetDomains.length) return presetDomains
    const normalized = normalizeProtectionDomain(app)
    return normalized.includes('.') ? [normalized] : []
  })
}

function normalizeSetupId(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || fallback
}

function normalizeSetupName(value, fallback = 'Focus setup') {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 48) || fallback
}

export function normalizeProtectionSetup(setup, fallbackId = DEFAULT_PROTECTION_SETUP_ID) {
  const baseFocusApps = normalizeProtectionAppList(setup?.focusApps)
  const baseDistractionApps = normalizeProtectionAppList(setup?.distractionApps)
  const derivedFocusDomains = normalizeProtectionDomainList(deriveDomainsFromApps(baseFocusApps))
  const derivedDistractionDomains = normalizeProtectionDomainList(deriveDomainsFromApps(baseDistractionApps))
  // Older builds could persist domain-only rules. Fold those into the editable
  // lists so every enforced rule remains visible and removable in the new UI.
  const focusApps = normalizeProtectionAppList([
    ...baseFocusApps,
    ...normalizeProtectionDomainList(setup?.focusDomains).filter(domain => !derivedFocusDomains.includes(domain)),
  ])
  const distractionApps = normalizeProtectionAppList([
    ...baseDistractionApps,
    ...normalizeProtectionDomainList(setup?.distractionDomains).filter(domain => !derivedDistractionDomains.includes(domain)),
  ])
  return {
    id: normalizeSetupId(setup?.id, fallbackId),
    name: normalizeSetupName(setup?.name, DEFAULT_PROTECTION_SETUP_NAME),
    focusApps,
    distractionApps,
    focusDomains: normalizeProtectionDomainList(deriveDomainsFromApps(focusApps)),
    distractionDomains: normalizeProtectionDomainList(deriveDomainsFromApps(distractionApps)),
    strictMode: Boolean(setup?.strictMode),
  }
}

export function createDefaultProtectionSetup(legacy = {}) {
  return normalizeProtectionSetup({
    id: DEFAULT_PROTECTION_SETUP_ID,
    name: DEFAULT_PROTECTION_SETUP_NAME,
    focusApps: legacy.focusApps,
    distractionApps: legacy.distractionApps,
    focusDomains: legacy.focusDomains,
    distractionDomains: legacy.distractionDomains,
    strictMode: legacy.strictMode,
  })
}

export function normalizeProtectionState(value, legacy = {}) {
  const rawSetups = Array.isArray(value?.setups) && value.setups.length
    ? value.setups
    : [createDefaultProtectionSetup(legacy)]
  const ids = new Set()
  const setups = rawSetups.map((setup, index) => {
    const base = normalizeProtectionSetup(setup, index === 0 ? DEFAULT_PROTECTION_SETUP_ID : `setup-${index + 1}`)
    let id = base.id
    let suffix = 2
    while (ids.has(id)) {
      id = `${base.id}-${suffix}`
      suffix += 1
    }
    ids.add(id)
    return { ...base, id }
  })
  const requestedActiveId = String(value?.activeSetupId || '')
  const activeSetupId = ids.has(requestedActiveId) ? requestedActiveId : setups[0].id
  return { schemaVersion: PROTECTION_SETUP_SCHEMA_VERSION, activeSetupId, setups }
}

export function getActiveProtectionSetup(state) {
  const normalized = normalizeProtectionState(state)
  return normalized.setups.find(setup => setup.id === normalized.activeSetupId) || normalized.setups[0]
}

export function updateActiveProtectionSetup(state, patch) {
  const normalized = normalizeProtectionState(state)
  const nextPatch = { ...patch }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'focusApps') && !Object.prototype.hasOwnProperty.call(nextPatch, 'focusDomains')) {
    nextPatch.focusDomains = []
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'distractionApps') && !Object.prototype.hasOwnProperty.call(nextPatch, 'distractionDomains')) {
    nextPatch.distractionDomains = []
  }
  return normalizeProtectionState({
    ...normalized,
    setups: normalized.setups.map(setup => setup.id === normalized.activeSetupId
      ? { ...setup, ...nextPatch, id: setup.id }
      : setup),
  })
}

export function activateProtectionSetup(state, setupId) {
  const normalized = normalizeProtectionState(state)
  return normalized.setups.some(setup => setup.id === setupId)
    ? { ...normalized, activeSetupId: setupId }
    : normalized
}

export function nextProtectionSetupName(setups) {
  const names = new Set((setups || []).map(setup => String(setup?.name || '').toLowerCase()))
  let index = 1
  while (names.has(`focus setup ${index}`)) index += 1
  return `Focus setup ${index}`
}

export function createProtectionSetup(state, { name, copyActive = false, idSeed = Date.now() } = {}) {
  const normalized = normalizeProtectionState(state)
  const active = getActiveProtectionSetup(normalized)
  const baseName = normalizeSetupName(name, copyActive ? `${active.name} copy` : nextProtectionSetupName(normalized.setups))
  const requestedId = normalizeSetupId(`${baseName}-${idSeed}`, `setup-${idSeed}`)
  const existingIds = new Set(normalized.setups.map(setup => setup.id))
  let id = requestedId
  let suffix = 2
  while (existingIds.has(id)) {
    id = `${requestedId}-${suffix}`
    suffix += 1
  }
  const setup = normalizeProtectionSetup({
    id,
    name: baseName,
    focusApps: copyActive ? active.focusApps : [],
    distractionApps: copyActive ? active.distractionApps : [],
    focusDomains: copyActive ? active.focusDomains : [],
    distractionDomains: copyActive ? active.distractionDomains : [],
    strictMode: copyActive ? active.strictMode : false,
  }, id)
  return { schemaVersion: PROTECTION_SETUP_SCHEMA_VERSION, activeSetupId: id, setups: [...normalized.setups, setup] }
}

export function removeProtectionSetup(state, setupId) {
  const normalized = normalizeProtectionState(state)
  if (normalized.setups.length === 1 || !normalized.setups.some(setup => setup.id === setupId)) {
    return normalized
  }
  const removedIndex = normalized.setups.findIndex(setup => setup.id === setupId)
  const setups = normalized.setups.filter(setup => setup.id !== setupId)
  const activeSetupId = normalized.activeSetupId === setupId
    ? setups[Math.min(removedIndex, setups.length - 1)].id
    : normalized.activeSetupId
  return { schemaVersion: PROTECTION_SETUP_SCHEMA_VERSION, activeSetupId, setups }
}
