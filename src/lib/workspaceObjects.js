export const WORKSPACE_ROLES = [
  { id: 'primary_screen', label: 'Primary screen' },
  { id: 'secondary_screen', label: 'Secondary screen' },
  { id: 'reference_material', label: 'Reference material' },
  { id: 'writing_surface', label: 'Writing surface' },
  { id: 'input_area', label: 'Input area' },
  { id: 'distraction_device', label: 'Distraction device' },
  { id: 'neutral', label: 'Neutral' },
]

export const WORKSPACE_OBJECT_TYPES = [
  { id: 'monitor', label: 'Monitor', defaultRole: 'primary_screen' },
  { id: 'laptop', label: 'Laptop', defaultRole: 'primary_screen' },
  { id: 'ipad', label: 'iPad', defaultRole: 'reference_material' },
  { id: 'phone', label: 'Phone', defaultRole: 'distraction_device' },
  { id: 'keyboard', label: 'Keyboard', defaultRole: 'input_area' },
  { id: 'mouse', label: 'Mouse', defaultRole: 'input_area' },
  { id: 'paper', label: 'Paper', defaultRole: 'writing_surface' },
  { id: 'notebook', label: 'Notebook', defaultRole: 'writing_surface' },
  { id: 'book', label: 'Book', defaultRole: 'reference_material' },
  { id: 'camera', label: 'Webcam', defaultRole: 'neutral' },
]

export const WORKSPACE_OBJECT_LABELS = Object.fromEntries(
  WORKSPACE_OBJECT_TYPES.map(type => [type.id, type.label])
)

export const WORKSPACE_ROLE_LABELS = Object.fromEntries(
  WORKSPACE_ROLES.map(role => [role.id, role.label])
)

const DEFAULT_ROLES = Object.fromEntries(
  WORKSPACE_OBJECT_TYPES.map(type => [type.id, type.defaultRole])
)
const KNOWN_TYPES = new Set(WORKSPACE_OBJECT_TYPES.map(type => type.id))

export function defaultRoleForType(type) {
  return DEFAULT_ROLES[type] || 'neutral'
}

export function normalizeWorkspaceObject(object, fallbackIndex = 0) {
  if (!object || typeof object !== 'object') return null
  const type = object.type
  if (!KNOWN_TYPES.has(type)) return null
  const col = Number(object.col)
  const row = Number(object.row)
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null

  return {
    ...object,
    id: object.id || `${type}_${fallbackIndex}`,
    type,
    col,
    row,
    role: object.role || defaultRoleForType(type),
    scale: typeof object.scale === 'number' ? object.scale : 1,
  }
}

export function normalizeWorkspaceObjects(objects = []) {
  return objects
    .map((object, index) => normalizeWorkspaceObject(object, index))
    .filter(Boolean)
}

export function isScreenRole(role) {
  return role === 'primary_screen' || role === 'secondary_screen'
}

export function isProductiveDownwardRole(role) {
  return role === 'reference_material' ||
    role === 'writing_surface' ||
    role === 'input_area'
}
