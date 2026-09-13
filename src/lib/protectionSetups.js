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

const SETUP_NAME_MAX_LENGTH = 48

export function cleanProtectionSetupName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, SETUP_NAME_MAX_LENGTH)
}

function setupNameKey(value) {
  return cleanProtectionSetupName(value).toLowerCase()
}

function normalizeSetupName(value, fallback = 'Focus setup') {
  return cleanProtectionSetupName(value) || fallback
}

// Setup names are the only thing that tells setups apart in the library and in
// the session picker, so a blank or repeated name is a user-facing error, not
// something to paper over with a shared default.
export function protectionSetupNameIssue(setups, setupId) {
  const setup = (setups || []).find(item => item.id === setupId)
  if (!setup) return null
  const key = setupNameKey(setup.name)
  if (!key) return 'blank'
  return (setups || []).some(item => item.id !== setupId && setupNameKey(item.name) === key)
    ? 'duplicate'
    : null
}

export function firstProtectionSetupWithNameIssue(setups) {
  return (setups || []).find(setup => protectionSetupNameIssue(setups, setup.id)) || null
}

function suffixedSetupName(name, suffix) {
  const tail = ` ${suffix}`
  return `${name.slice(0, SETUP_NAME_MAX_LENGTH - tail.length).trimEnd()}${tail}`
}

export function normalizeProtectionSetup(setup, fallbackId = DEFAULT_PROTECTION_SETUP_ID, fallbackName = DEFAULT_PROTECTION_SETUP_NAME) {
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
    name: normalizeSetupName(setup?.name, fallbackName),
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
  // Explicit names are reserved up front so a generated name for a blank setup
  // or a suffixed duplicate never collides with a name that appears later.
  const reservedNames = new Set(rawSetups.map(setup => setupNameKey(setup?.name)).filter(Boolean))
  const usedNames = new Set()
  const setups = rawSetups.map((setup, index) => {
    const base = normalizeProtectionSetup(setup, index === 0 ? DEFAULT_PROTECTION_SETUP_ID : `setup-${index + 1}`)
    let id = base.id
    let suffix = 2
    while (ids.has(id)) {
      id = `${base.id}-${suffix}`
      suffix += 1
    }
    ids.add(id)

    const requestedName = cleanProtectionSetupName(setup?.name)
    let name
    if (!requestedName) {
      let counter = 1
      do {
        name = `Focus setup ${counter}`
        counter += 1
      } while (reservedNames.has(name.toLowerCase()) || usedNames.has(name.toLowerCase()))
    } else {
      name = requestedName
      let counter = 2
      while (usedNames.has(name.toLowerCase())) {
        name = suffixedSetupName(requestedName, counter)
        counter += 1
      }
    }
    usedNames.add(name.toLowerCase())
    return { ...base, id, name }
  })
  const requestedActiveId = String(value?.activeSetupId || '')
  const activeSetupId = ids.has(requestedActiveId) ? requestedActiveId : setups[0].id
  return { schemaVersion: PROTECTION_SETUP_SCHEMA_VERSION, activeSetupId, setups }
}

// Comparison key for an editor draft. It uses the normalized (saved) shape so
// derived fields can't create phantom changes, but keeps each setup's name as
// typed: normalization replaces a blank name with a generated one, which would
// otherwise make a cleared name look identical to the saved "Focus setup N".
export function protectionDraftKey(state) {
  const normalized = normalizeProtectionState(state)
  const rawSetups = Array.isArray(state?.setups) && state.setups.length ? state.setups : null
  return JSON.stringify({
    ...normalized,
    setups: normalized.setups.map((setup, index) => ({
      ...setup,
      name: rawSetups ? cleanProtectionSetupName(rawSetups[index]?.name) : setup.name,
    })),
  })
}

export function getActiveProtectionSetup(state) {
  const normalized = normalizeProtectionState(state)
  return normalized.setups.find(setup => setup.id === normalized.activeSetupId) || normalized.setups[0]
}

export function updateProtectionSetup(state, setupId, patch) {
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
    setups: normalized.setups.map(setup => setup.id === setupId
      ? { ...setup, ...nextPatch, id: setup.id }
      : setup),
  })
}

export function updateActiveProtectionSetup(state, patch) {
  const normalized = normalizeProtectionState(state)
  return updateProtectionSetup(normalized, normalized.activeSetupId, patch)
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

export function createProtectionSetup(state, { name, copyActive = false, copyFromId = null, activate = true, idSeed = Date.now() } = {}) {
  const normalized = normalizeProtectionState(state)
  const source = copyFromId
    ? normalized.setups.find(setup => setup.id === copyFromId) || null
    : copyActive ? getActiveProtectionSetup(normalized) : null
  const baseName = normalizeSetupName(name, source ? `${source.name} copy` : nextProtectionSetupName(normalized.setups))
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
    focusApps: source ? source.focusApps : [],
    distractionApps: source ? source.distractionApps : [],
    focusDomains: source ? source.focusDomains : [],
    distractionDomains: source ? source.distractionDomains : [],
    strictMode: source ? source.strictMode : false,
  }, id)
  return normalizeProtectionState({
    activeSetupId: activate ? id : normalized.activeSetupId,
    setups: [...normalized.setups, setup],
  })
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
