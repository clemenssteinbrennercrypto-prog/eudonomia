const unitDimensions = Object.freeze({ width: 1, height: 1, depth: 1 })
const unitBounds = Object.freeze({ width: 1, height: 1 })

function preset(id, label, dimensions = unitDimensions, attentionBounds = unitBounds, physicalSize = null) {
  return Object.freeze({
    id,
    label,
    dimensions: Object.freeze(dimensions),
    attentionBounds: Object.freeze(attentionBounds),
    physicalSize: physicalSize ? Object.freeze(physicalSize) : null,
  })
}

export const WORKSPACE_SIZE_PRESETS = Object.freeze({
  monitor: Object.freeze([
    preset('monitor_24', '24 in (61 cm)', { width: 0.89, height: 0.89, depth: 1 }, { width: 0.89, height: 0.89 }, { diagonalInches: 24, aspectRatio: '16:9' }),
    preset('monitor_27', '27 in (69 cm)', unitDimensions, unitBounds, { diagonalInches: 27, aspectRatio: '16:9' }),
    preset('monitor_32', '32 in (81 cm)', { width: 1.19, height: 1.19, depth: 1 }, { width: 1.19, height: 1.19 }, { diagonalInches: 32, aspectRatio: '16:9' }),
    preset('monitor_34_ultrawide', '34 in ultrawide (86 cm)', { width: 1.33, height: 1, depth: 1 }, { width: 1.33, height: 1 }, { diagonalInches: 34, aspectRatio: '21:9' }),
  ]),
  laptop: Object.freeze([
    preset('laptop_13', '13 in (33 cm)', { width: 0.93, height: 0.93, depth: 0.93 }, { width: 0.93, height: 0.93 }, { diagonalInches: 13, aspectRatio: '16:10' }),
    preset('laptop_14', '14 in (36 cm)', unitDimensions, unitBounds, { diagonalInches: 14, aspectRatio: '16:10' }),
    preset('laptop_16', '16 in (41 cm)', { width: 1.14, height: 1.14, depth: 1.14 }, { width: 1.14, height: 1.14 }, { diagonalInches: 16, aspectRatio: '16:10' }),
  ]),
  ipad: Object.freeze([
    preset('ipad_11', '11 in (28 cm)'),
    preset('ipad_13', '13 in (33 cm)', { width: 1.18, height: 1, depth: 1.18 }, { width: 1.18, height: 1.18 }),
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
  camera: Object.freeze([preset('camera_standard', 'Lens')]),
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

const CUSTOM_SCREEN_CONFIG = Object.freeze({
  monitor: Object.freeze({ min: 15, max: 65, referenceDiagonal: 27, referenceRatio: '16:9', ratios: Object.freeze(['16:9', '16:10', '21:9', '32:9']) }),
  laptop: Object.freeze({ min: 10, max: 20, referenceDiagonal: 14, referenceRatio: '16:10', ratios: Object.freeze(['16:10', '16:9', '3:2']) }),
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

function ratioParts(value, fallback = '16:9') {
  const [width, height] = String(value || fallback).split(':').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return ratioParts(fallback, '16:9')
  }
  return { width, height }
}

function physicalScreenDimensions(diagonal, aspectRatio) {
  const ratio = ratioParts(aspectRatio)
  const divisor = Math.sqrt(ratio.width ** 2 + ratio.height ** 2)
  return { width: diagonal * ratio.width / divisor, height: diagonal * ratio.height / divisor }
}

export function sizePresetsForType(type) {
  return WORKSPACE_SIZE_PRESETS[type] || []
}

export function customScreenConfig(type) {
  return CUSTOM_SCREEN_CONFIG[type] || null
}

export function suggestedCustomScreenSize(object = {}) {
  const config = customScreenConfig(object.type)
  if (!config) return null
  const presetSize = PRESETS_BY_ID.get(object.sizePreset)?.physicalSize
  const supplied = object.physicalSize
  const diagonal = Number(supplied?.diagonalInches ?? presetSize?.diagonalInches ?? config.referenceDiagonal)
  const aspectRatio = config.ratios.includes(supplied?.aspectRatio)
    ? supplied.aspectRatio
    : config.ratios.includes(presetSize?.aspectRatio) ? presetSize.aspectRatio : config.referenceRatio
  return {
    unit: 'in',
    diagonalInches: Math.max(config.min, Math.min(config.max, Number.isFinite(diagonal) ? diagonal : config.referenceDiagonal)),
    aspectRatio,
  }
}

export function workspaceSizeFromPhysicalScreen(type, diagonalInches, aspectRatio) {
  const config = customScreenConfig(type)
  if (!config) return null
  const diagonal = Math.max(config.min, Math.min(config.max, Number(diagonalInches) || config.referenceDiagonal))
  const ratio = config.ratios.includes(aspectRatio) ? aspectRatio : config.referenceRatio
  const physical = physicalScreenDimensions(diagonal, ratio)
  const reference = physicalScreenDimensions(config.referenceDiagonal, config.referenceRatio)
  const width = finiteDimension(physical.width / reference.width)
  const height = finiteDimension(physical.height / reference.height)
  return {
    sizePreset: null,
    physicalSize: { unit: 'in', diagonalInches: diagonal, aspectRatio: ratio },
    dimensions: {
      width,
      height,
      depth: type === 'laptop' ? height : finiteDimension(Math.sqrt(width * height)),
    },
    attentionBounds: { width, height },
  }
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
  if (object.physicalSize && customScreenConfig(object.type)) {
    const physical = suggestedCustomScreenSize(object)
    return workspaceSizeFromPhysicalScreen(object.type, physical.diagonalInches, physical.aspectRatio)
  }
  const dimensions = dimensionsFrom(object)
  const attentionBounds = boundsFrom(object, dimensions)
  const legacyScale = Number(object.scene?.scale ?? object.scale ?? 1)
  const legacyIsDefault = object.sizePreset !== 'custom' && Math.abs(legacyScale - 1) < 0.001 && isUnit(dimensions, ['width', 'height', 'depth']) && isUnit(attentionBounds, ['width', 'height'])
  if (legacyIsDefault) return defaultWorkspaceSize(object.type)
  return { sizePreset: null, dimensions, attentionBounds }
}
