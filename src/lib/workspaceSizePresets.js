const unitDimensions = Object.freeze({ width: 1, height: 1, depth: 1 })
const unitBounds = Object.freeze({ width: 1, height: 1 })

function preset(id, label, dimensions = unitDimensions, attentionBounds = unitBounds) {
  return Object.freeze({ id, label, dimensions: Object.freeze(dimensions), attentionBounds: Object.freeze(attentionBounds) })
}

export const WORKSPACE_SIZE_PRESETS = Object.freeze({
  monitor: Object.freeze([
    preset('monitor_24', '24″', { width: 0.89, height: 0.89, depth: 1 }, { width: 0.89, height: 0.89 }),
    preset('monitor_27', '27″'),
    preset('monitor_32', '32″', { width: 1.19, height: 1.19, depth: 1 }, { width: 1.19, height: 1.19 }),
    preset('monitor_34_ultrawide', '34″ ultrawide', { width: 1.33, height: 1, depth: 1 }, { width: 1.33, height: 1 }),
  ]),
  laptop: Object.freeze([
    preset('laptop_13', '13″', { width: 0.93, height: 0.93, depth: 0.93 }, { width: 0.93, height: 0.93 }),
    preset('laptop_14', '14″'),
    preset('laptop_16', '16″', { width: 1.14, height: 1.14, depth: 1.14 }, { width: 1.14, height: 1.14 }),
  ]),
  ipad: Object.freeze([
    preset('ipad_11', '11″'),
    preset('ipad_13', '13″', { width: 1.18, height: 1, depth: 1.18 }, { width: 1.18, height: 1.18 }),
  ]),
  keyboard: Object.freeze([
    preset('keyboard_compact', 'Compact', { width: 0.78, height: 1, depth: 0.85 }, { width: 0.78, height: 0.85 }),
    preset('keyboard_standard', 'Standard'),
  ]),
  paper: Object.freeze([
    preset('paper_a5', 'A5', { width: 0.71, height: 1, depth: 0.71 }, { width: 0.71, height: 0.71 }),
    preset('paper_a4', 'A4'),
  ]),
  notebook: Object.freeze([
    preset('notebook_a5', 'A5'),
    preset('notebook_a4', 'A4', { width: 1.41, height: 1, depth: 1.41 }, { width: 1.41, height: 1.41 }),
  ]),
  book: Object.freeze([
    preset('book_standard', 'Standard'),
    preset('book_large', 'Large', { width: 1.2, height: 1.2, depth: 1.2 }, { width: 1.2, height: 1.2 }),
  ]),
  phone: Object.freeze([preset('phone_standard', 'Standard')]),
  mouse: Object.freeze([preset('mouse_standard', 'Standard')]),
  camera: Object.freeze([preset('camera_standard', 'Standard webcam')]),
})

const PRESETS_BY_ID = new Map(Object.values(WORKSPACE_SIZE_PRESETS).flat().map(item => [item.id, item]))
const DEFAULT_PRESET_IDS = Object.freeze({
  monitor: 'monitor_27',
  laptop: 'laptop_14',
  ipad: 'ipad_11',
  keyboard: 'keyboard_standard',
  paper: 'paper_a4',
  notebook: 'notebook_a5',
  book: 'book_standard',
  phone: 'phone_standard',
  mouse: 'mouse_standard',
  camera: 'camera_standard',
})

function finiteDimension(value, fallback = 1) {
  const number = Number(value)
  return Math.max(0.4, Math.min(2.8, Number.isFinite(number) ? number : fallback))
}

function dimensionsFrom(object = {}) {
  return {
    width: finiteDimension(object.dimensions?.width),
    height: finiteDimension(object.dimensions?.height),
    depth: finiteDimension(object.dimensions?.depth),
  }
}

function boundsFrom(object = {}, dimensions = dimensionsFrom(object)) {
  return {
    width: finiteDimension(object.attentionBounds?.width, dimensions.width),
    height: finiteDimension(object.attentionBounds?.height, dimensions.height),
  }
}

function isUnit(values, keys) {
  return keys.every(key => Math.abs((values[key] ?? 1) - 1) < 0.001)
}

function clonePresetSize(item) {
  return {
    sizePreset: item.id,
    dimensions: { ...item.dimensions },
    attentionBounds: { ...item.attentionBounds },
  }
}

export function sizePresetsForType(type) {
  return WORKSPACE_SIZE_PRESETS[type] || []
}

export function defaultWorkspaceSize(type) {
  const item = PRESETS_BY_ID.get(DEFAULT_PRESET_IDS[type])
  return item ? clonePresetSize(item) : { sizePreset: null, dimensions: { ...unitDimensions }, attentionBounds: { ...unitBounds } }
}

export function workspaceSizeFromPreset(type, presetId) {
  const item = sizePresetsForType(type).find(candidate => candidate.id === presetId)
  return item ? clonePresetSize(item) : null
}

export function normalizeWorkspaceSize(object = {}) {
  const explicit = workspaceSizeFromPreset(object.type, object.sizePreset)
  if (explicit) return explicit
  const dimensions = dimensionsFrom(object)
  const attentionBounds = boundsFrom(object, dimensions)
  const legacyScale = Number(object.scene?.scale ?? object.scale ?? 1)
  const legacyIsDefault = object.sizePreset !== 'custom' && Math.abs(legacyScale - 1) < 0.001 && isUnit(dimensions, ['width', 'height', 'depth']) && isUnit(attentionBounds, ['width', 'height'])
  if (legacyIsDefault) return defaultWorkspaceSize(object.type)
  return { sizePreset: null, dimensions, attentionBounds }
}
