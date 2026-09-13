import { describe, expect, it } from 'vitest'
import {
  deleteWorkspace,
  duplicateWorkspace,
  getActiveWorkspace,
  invalidateObjectCalibration,
  migrateLegacyDevices,
  normalizeWorkspaceState,
  saveWorkspaceDraft,
  saveWorkspaceState,
  workspaceSnapshot,
} from './workspaceStore'

const devices = [
  { id: 'screen', type: 'monitor', col: 0.2, row: 0.5, role: 'primary_screen' },
  { id: 'camera', type: 'camera', col: 0.5, row: 0.05, role: 'neutral' },
]

describe('workspace storage', () => {
  it('migrates the legacy device array without reinterpreting its tracking coordinates', () => {
    const state = migrateLegacyDevices(devices, 10)
    const active = getActiveWorkspace(state)
    expect(active.name).toBe('Imported workspace')
    expect(active.objects[0]).toMatchObject({ col: 0.2, row: 0.5 })
    expect(active.objects[0]).toMatchObject({ sizePreset: 'monitor_27', attentionBounds: { width: 1, height: 1 } })
    expect(active.objects[0].dimensions).toEqual({ width: 1, height: 1, depth: 1 })
    expect(active.calibration.status).toBe('uncalibrated')
  })

  it('preserves independent object dimensions and clamps unusable values', () => {
    const state = migrateLegacyDevices([
      { ...devices[0], dimensions: { width: 2.4, height: 0.7, depth: 99 } },
      devices[1],
    ])
    expect(getActiveWorkspace(state).objects[0].dimensions).toEqual({ width: 2.4, height: 0.7, depth: 2.8 })
    expect(getActiveWorkspace(state).objects[0]).toMatchObject({ sizePreset: null, attentionBounds: { width: 2.4, height: 0.7 } })
  })

  it('persists custom screen measurements and derives geometry from them', () => {
    const state = migrateLegacyDevices([
      { ...devices[0], sizePreset: null, physicalSize: { unit: 'in', diagonalInches: 30.5, aspectRatio: '16:10' } },
      devices[1],
    ])
    const monitor = getActiveWorkspace(state).objects[0]
    expect(monitor.physicalSize).toEqual({ unit: 'in', diagonalInches: 30.5, aspectRatio: '16:10' })
    expect(monitor.sizePreset).toBeNull()
    expect(monitor.dimensions.width).toBeGreaterThan(1)
    expect(monitor.attentionBounds.height).toBe(monitor.dimensions.height)
  })

  it('preserves a valid camera mount and detaches it when the target is missing', () => {
    const mounted = migrateLegacyDevices([
      devices[0],
      { ...devices[1], cameraMount: { targetId: 'screen', style: 'top', offsetX: -.35 } },
    ])
    const camera = getActiveWorkspace(mounted).objects[1]
    expect(camera.cameraMount).toEqual({ targetId: 'screen', style: 'top', offsetX: -.35 })
    expect(camera.col).toBeCloseTo(.158)
    expect(camera.row).toBeCloseTo(.26)

    const detached = migrateLegacyDevices([
      devices[0],
      { ...devices[1], cameraMount: { targetId: 'missing', style: 'integrated', offsetX: 0 } },
    ])
    expect(getActiveWorkspace(detached).objects[1].cameraMount).toBeNull()
  })

  it('repairs an unknown active id to the first valid workspace', () => {
    const migrated = migrateLegacyDevices(devices)
    const state = normalizeWorkspaceState({ ...migrated, activeWorkspaceId: 'missing' })
    expect(state.activeWorkspaceId).toBe(state.workspaces[0].id)
  })

  it('increments revisions only when a draft is explicitly saved', () => {
    const state = migrateLegacyDevices(devices)
    const draft = { ...getActiveWorkspace(state), name: 'Home desk' }
    const saved = saveWorkspaceDraft(state, draft)
    expect(getActiveWorkspace(saved)).toMatchObject({ name: 'Home desk', revision: 2 })
  })

  it('duplicates complete configuration with a new identity', () => {
    const state = migrateLegacyDevices(devices)
    const duplicate = duplicateWorkspace(state, state.activeWorkspaceId)
    expect(duplicate.workspaces).toHaveLength(2)
    expect(duplicate.activeWorkspaceId).not.toBe(state.activeWorkspaceId)
    expect(getActiveWorkspace(duplicate).objects).toEqual(getActiveWorkspace(state).objects)
  })

  it('refuses to delete the last required workspace', () => {
    const state = migrateLegacyDevices(devices)
    expect(deleteWorkspace(state, state.activeWorkspaceId)).toEqual(state)
  })

  it('reports storage failures instead of claiming the draft was saved', () => {
    const storage = { setItem() { throw new Error('quota') } }
    expect(saveWorkspaceState(migrateLegacyDevices(devices), storage)).toMatchObject({ ok: false, error: 'quota' })
  })

  it('creates an immutable session snapshot', () => {
    const state = migrateLegacyDevices([{ ...devices[0], dimensions: { width: 2.1, height: 0.8, depth: 1.4 } }, devices[1]])
    const workspace = getActiveWorkspace(state)
    const snapshot = workspaceSnapshot(workspace)
    workspace.objects[0].col = 0.9
    expect(snapshot.objects[0].col).toBe(0.2)
    expect(snapshot.objects[0].dimensions).toEqual({ width: 2.1, height: 0.8, depth: 1.4 })
  })

  it('invalidates one target or the complete relative calibration frame', () => {
    const workspace = getActiveWorkspace(migrateLegacyDevices(devices))
    workspace.calibration = {
      version: 1,
      status: 'calibrated',
      targets: {
        screen: { deltaYaw: 0, deltaPitch: 0, deltaIrisH: 0, quality: 1, sampleCount: 30 },
        camera: { deltaYaw: 1, deltaPitch: 1, deltaIrisH: 0, quality: 1, sampleCount: 30 },
      },
    }
    expect(Object.keys(invalidateObjectCalibration(workspace, 'screen').calibration.targets)).toEqual(['camera'])
    expect(invalidateObjectCalibration(workspace, 'camera', true).calibration.targets).toEqual({})
  })
})
