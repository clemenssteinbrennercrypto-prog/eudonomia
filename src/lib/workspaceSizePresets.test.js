import { describe, expect, it } from 'vitest'
import { defaultWorkspaceSize, normalizeWorkspaceSize, sizePresetsForType, workspaceSizeFromPreset } from './workspaceSizePresets'

describe('workspace size presets', () => {
  it('gives new devices a stable type-specific default', () => {
    expect(defaultWorkspaceSize('monitor')).toEqual({
      sizePreset: 'monitor_27',
      dimensions: { width: 1, height: 1, depth: 1 },
      attentionBounds: { width: 1, height: 1 },
    })
    expect(defaultWorkspaceSize('camera').sizePreset).toBe('camera_standard')
  })

  it('keeps monitor proportions coupled while supporting an ultrawide face', () => {
    expect(workspaceSizeFromPreset('monitor', 'monitor_32')).toMatchObject({
      dimensions: { width: 1.19, height: 1.19 },
      attentionBounds: { width: 1.19, height: 1.19 },
    })
    expect(workspaceSizeFromPreset('monitor', 'monitor_34_ultrawide')).toMatchObject({
      dimensions: { width: 1.33, height: 1 },
      attentionBounds: { width: 1.33, height: 1 },
    })
  })

  it('separates flat-object tracking height from its physical thickness', () => {
    expect(workspaceSizeFromPreset('keyboard', 'keyboard_compact')).toEqual({
      sizePreset: 'keyboard_compact',
      dimensions: { width: 0.78, height: 1, depth: 0.85 },
      attentionBounds: { width: 0.78, height: 0.85 },
    })
  })

  it('maps untouched legacy sizes to defaults without rewriting custom sizes', () => {
    expect(normalizeWorkspaceSize({ type: 'laptop', dimensions: { width: 1, height: 1, depth: 1 } }).sizePreset).toBe('laptop_14')
    expect(normalizeWorkspaceSize({ type: 'monitor', dimensions: { width: 2.4, height: 0.7, depth: 9 } })).toEqual({
      sizePreset: null,
      dimensions: { width: 2.4, height: 0.7, depth: 2.8 },
      attentionBounds: { width: 2.4, height: 0.7 },
    })
    expect(normalizeWorkspaceSize({ type: 'monitor', scene: { scale: 1.4 } }).sizePreset).toBeNull()
  })

  it('offers no freeform preset for fixed-size devices', () => {
    expect(sizePresetsForType('mouse').map(item => item.id)).toEqual(['mouse_standard'])
    expect(sizePresetsForType('camera').map(item => item.id)).toEqual(['camera_standard'])
  })
})
