import { describe, expect, it } from 'vitest'
import { customScreenConfig, defaultWorkspaceSize, normalizeWorkspaceSize, sizePresetsForType, workspaceSizeFromPhysicalScreen, workspaceSizeFromPreset } from './workspaceSizePresets'

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

  it('derives accurate custom monitor proportions from inches and aspect ratio', () => {
    const custom = workspaceSizeFromPhysicalScreen('monitor', 34, '21:9')
    expect(custom).toMatchObject({
      sizePreset: null,
      physicalSize: { unit: 'in', diagonalInches: 34, aspectRatio: '21:9' },
    })
    expect(custom.dimensions.width).toBeCloseTo(1.33, 2)
    expect(custom.dimensions.height).toBeCloseTo(1.01, 2)
    expect(custom.attentionBounds).toEqual({ width: custom.dimensions.width, height: custom.dimensions.height })
  })

  it('limits custom physical input to meaningful device-specific ranges', () => {
    expect(customScreenConfig('monitor').ratios).toContain('32:9')
    expect(workspaceSizeFromPhysicalScreen('laptop', 99, '16:10').physicalSize.diagonalInches).toBe(20)
    expect(workspaceSizeFromPhysicalScreen('mouse', 14, '16:9')).toBeNull()
  })

  it('rebuilds custom dimensions from stored physical measurements', () => {
    const normalized = normalizeWorkspaceSize({
      type: 'monitor',
      physicalSize: { unit: 'in', diagonalInches: 30, aspectRatio: '16:10' },
      dimensions: { width: 2.8, height: 0.4, depth: 2.8 },
    })
    expect(normalized.physicalSize).toEqual({ unit: 'in', diagonalInches: 30, aspectRatio: '16:10' })
    expect(normalized.dimensions).not.toEqual({ width: 2.8, height: 0.4, depth: 2.8 })
  })
})
