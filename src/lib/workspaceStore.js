import { defaultRoleForType, normalizeWorkspaceObjects } from './workspaceObjects'

export const WORKSPACE_STORAGE_KEY = 'eudaimonia_workspaces_v1'
export const LEGACY_WORKSPACE_KEY = 'eudaimonia_devices'
export const WORKSPACE_SCHEMA_VERSION = 1
export const CALIBRATION_VERSION = 1

const VALID_STATUSES = new Set(['uncalibrated', 'partial', 'calibrated'])

function uid(prefix = 'workspace') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function dimension(value) {
  return Math.max(0.4, Math.min(2.8, finite(value, 1)))
}

export function sceneFromLegacy(object = {}) {
  return {
    x: Math.max(-1, Math.min(1, finite(object.col, 0.5) * 2 - 1)),
    y: Math.max(-1, Math.min(1, 1 - finite(object.row, 0.5) * 2)),
    z: Math.max(0, Math.min(1, finite(object.row, 0.5))),
    scale: Math.max(0.4, Math.min(2.4, finite(object.scale, 1))),
    rotation: finite(object.rotation, 0),
  }
}

export function normalizeWorkspaceItem(object, index = 0) {
  const [legacy] = normalizeWorkspaceObjects([object])
  if (!legacy) return null
  const scene = object.scene && typeof object.scene === 'object'
    ? {
        x: Math.max(-1, Math.min(1, finite(object.scene.x, 0))),
        y: Math.max(-1, Math.min(1, finite(object.scene.y, 0))),
        z: Math.max(0, Math.min(1, finite(object.scene.z, 0.5))),
        scale: Math.max(0.4, Math.min(2.4, finite(object.scene.scale, legacy.scale))),
        rotation: Math.max(-180, Math.min(180, finite(object.scene.rotation, 0))),
      }
    : sceneFromLegacy(legacy)
  return {
    ...legacy,
    id: String(object.id || `${legacy.type}_${index}`),
    role: object.role || defaultRoleForType(legacy.type),
    scene,
    dimensions: {
      width: dimension(object.dimensions?.width),
      height: dimension(object.dimensions?.height),
      depth: dimension(object.dimensions?.depth),
    },
    calibrationTarget: object.calibrationTarget !== false,
  }
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') return null
  const values = ['deltaYaw', 'deltaPitch', 'deltaIrisH']
  if (!values.every(key => Number.isFinite(Number(target[key])))) return null
  return {
    deltaYaw: Number(target.deltaYaw),
    deltaPitch: Number(target.deltaPitch),
    deltaIrisH: Number(target.deltaIrisH),
    quality: Math.max(0, Math.min(1, finite(target.quality, 0))),
    sampleCount: Math.max(0, Math.floor(finite(target.sampleCount, 0))),
  }
}

export function normalizeCalibration(calibration, objects = []) {
  const objectIds = new Set(objects.map(object => object.id))
  const targets = {}
  for (const [id, target] of Object.entries(calibration?.targets || {})) {
    const normalized = objectIds.has(id) ? normalizeTarget(target) : null
    if (normalized) targets[id] = normalized
  }
  const targetable = objects.filter(object => object.calibrationTarget !== false)
  const captured = targetable.filter(object => targets[object.id]).length
  const status = captured === 0 ? 'uncalibrated' : captured === targetable.length ? 'calibrated' : 'partial'
  return {
    version: CALIBRATION_VERSION,
    status: VALID_STATUSES.has(status) ? status : 'uncalibrated',
    capturedAt: captured ? finite(calibration?.capturedAt, Date.now()) : null,
    primaryObjectId: objectIds.has(calibration?.primaryObjectId) ? calibration.primaryObjectId : null,
    cameraObjectId: objectIds.has(calibration?.cameraObjectId) ? calibration.cameraObjectId : null,
    targets,
  }
}

export function normalizeWorkspace(workspace, index = 0) {
  if (!workspace || typeof workspace !== 'object') return null
  const objects = (Array.isArray(workspace.objects) ? workspace.objects : [])
    .map(normalizeWorkspaceItem)
    .filter(Boolean)
  if (!objects.length) return null
  const now = Date.now()
  return {
    id: String(workspace.id || uid('workspace')),
    name: String(workspace.name || `Workspace ${index + 1}`).trim().slice(0, 50) || `Workspace ${index + 1}`,
    revision: Math.max(1, Math.floor(finite(workspace.revision, 1))),
    createdAt: finite(workspace.createdAt, now),
    updatedAt: finite(workspace.updatedAt, now),
    objects,
    calibration: normalizeCalibration(workspace.calibration, objects),
  }
}

export function emptyWorkspaceState() {
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activeWorkspaceId: null, workspaces: [] }
}

export function normalizeWorkspaceState(state) {
  const workspaces = (Array.isArray(state?.workspaces) ? state.workspaces : [])
    .map(normalizeWorkspace)
    .filter(Boolean)
  const requested = String(state?.activeWorkspaceId || '')
  const activeWorkspaceId = workspaces.some(workspace => workspace.id === requested)
    ? requested
    : workspaces[0]?.id || null
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activeWorkspaceId, workspaces }
}

export function migrateLegacyDevices(rawDevices, now = Date.now()) {
  const objects = normalizeWorkspaceObjects(Array.isArray(rawDevices) ? rawDevices : [])
    .map((object, index) => normalizeWorkspaceItem(object, index))
    .filter(Boolean)
  if (!objects.length) return emptyWorkspaceState()
  const workspace = normalizeWorkspace({
    id: 'workspace_imported',
    name: 'Imported workspace',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    objects,
    calibration: { status: 'uncalibrated', targets: {} },
  })
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activeWorkspaceId: workspace.id, workspaces: [workspace] }
}

export function loadWorkspaceState(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(WORKSPACE_STORAGE_KEY) || 'null')
    if (stored) return normalizeWorkspaceState(stored)
    const legacy = JSON.parse(storage?.getItem(LEGACY_WORKSPACE_KEY) || '[]')
    const migrated = migrateLegacyDevices(legacy)
    if (migrated.workspaces.length) storage?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(migrated))
    return migrated
  } catch {
    return emptyWorkspaceState()
  }
}

export function saveWorkspaceState(state, storage = globalThis.localStorage) {
  const normalized = normalizeWorkspaceState(state)
  try {
    storage?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(normalized))
    return { ok: true, state: normalized }
  } catch (error) {
    return { ok: false, state: normalized, error: error instanceof Error ? error.message : 'Workspace could not be saved.' }
  }
}

export function getActiveWorkspace(state) {
  const normalized = normalizeWorkspaceState(state)
  return normalized.workspaces.find(workspace => workspace.id === normalized.activeWorkspaceId) || null
}

export function workspaceDevices(workspace) {
  return normalizeWorkspaceObjects(workspace?.objects || [])
}

export function createWorkspace({ name, objects }) {
  return normalizeWorkspace({ id: uid('workspace'), name, objects, revision: 1, createdAt: Date.now(), updatedAt: Date.now() })
}

export function saveWorkspaceDraft(state, draft) {
  const normalizedState = normalizeWorkspaceState(state)
  const existing = normalizedState.workspaces.find(workspace => workspace.id === draft?.id)
  const next = normalizeWorkspace({
    ...draft,
    revision: existing ? existing.revision + 1 : Math.max(1, draft?.revision || 1),
    createdAt: existing?.createdAt || draft?.createdAt || Date.now(),
    updatedAt: Date.now(),
  })
  if (!next) return normalizedState
  const workspaces = existing
    ? normalizedState.workspaces.map(workspace => workspace.id === next.id ? next : workspace)
    : [...normalizedState.workspaces, next]
  return normalizeWorkspaceState({ ...normalizedState, activeWorkspaceId: next.id, workspaces })
}

export function duplicateWorkspace(state, id) {
  const source = normalizeWorkspaceState(state).workspaces.find(workspace => workspace.id === id)
  if (!source) return normalizeWorkspaceState(state)
  const copy = normalizeWorkspace({
    ...structuredClone(source),
    id: uid('workspace'),
    name: `${source.name} copy`.slice(0, 50),
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  return normalizeWorkspaceState({ ...state, activeWorkspaceId: copy.id, workspaces: [...normalizeWorkspaceState(state).workspaces, copy] })
}

export function deleteWorkspace(state, id) {
  const normalized = normalizeWorkspaceState(state)
  if (normalized.workspaces.length <= 1) return normalized
  return normalizeWorkspaceState({ ...normalized, workspaces: normalized.workspaces.filter(workspace => workspace.id !== id) })
}

export function workspaceSnapshot(workspace) {
  const normalized = normalizeWorkspace(workspace)
  if (!normalized) return null
  return structuredClone({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: normalized.id,
    name: normalized.name,
    revision: normalized.revision,
    objects: normalized.objects,
    calibration: normalized.calibration,
  })
}

export function invalidateObjectCalibration(workspace, objectId, invalidateAll = false) {
  const normalized = normalizeWorkspace(workspace)
  if (!normalized) return workspace
  const targets = { ...normalized.calibration.targets }
  if (invalidateAll) {
    for (const key of Object.keys(targets)) delete targets[key]
  } else {
    delete targets[objectId]
  }
  return { ...normalized, calibration: normalizeCalibration({ ...normalized.calibration, targets }, normalized.objects) }
}
