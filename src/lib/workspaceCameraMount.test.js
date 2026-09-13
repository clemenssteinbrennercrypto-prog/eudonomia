import { describe, expect, it } from 'vitest'
import { cameraMountTargets, cameraPositionFromMount, defaultCameraMount, normalizeCameraMount, resolveCameraMount } from './workspaceCameraMount'

const objects = [
  { id: 'paper', type: 'paper', role: 'writing_surface' },
  { id: 'side', type: 'monitor', role: 'secondary_screen' },
  { id: 'main', type: 'laptop', role: 'primary_screen' },
]

describe('workspace camera mounts', () => {
  it('offers only displays as camera mount targets', () => {
    expect(cameraMountTargets(objects).map(object => object.id)).toEqual(['side', 'main'])
  })

  it('defaults to the primary display and centers the lens', () => {
    expect(defaultCameraMount(objects)).toEqual({ targetId: 'main', style: 'integrated', offsetX: 0 })
  })

  it('normalizes style and clamps the horizontal bezel offset', () => {
    expect(normalizeCameraMount({ targetId: 'side', style: 'unknown', offsetX: 8 })).toEqual({
      targetId: 'side',
      style: 'integrated',
      offsetX: 1,
    })
  })

  it('detaches a camera when its display no longer exists', () => {
    expect(resolveCameraMount({ targetId: 'missing', style: 'top' }, objects)).toBeNull()
    expect(resolveCameraMount({ targetId: 'side', style: 'top', offsetX: -.4 }, objects)).toEqual({ targetId: 'side', style: 'top', offsetX: -.4 })
  })

  it('keeps legacy fallback coordinates aligned with the mounted display', () => {
    const position = cameraPositionFromMount({ targetId: 'main', style: 'integrated', offsetX: .5 }, [
      { id: 'main', type: 'laptop', col: .4, row: .52, role: 'primary_screen' },
    ])
    expect(position).toEqual({ col: .46, row: .32 })
  })
})
