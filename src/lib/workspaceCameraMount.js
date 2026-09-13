const DISPLAY_TYPES = new Set(['monitor', 'laptop'])
const MOUNT_STYLES = new Set(['integrated', 'top'])

function clampOffset(value) {
  const number = Number(value)
  return Math.max(-1, Math.min(1, Number.isFinite(number) ? number : 0))
}

export function cameraMountTargets(objects = []) {
  return objects.filter(object => DISPLAY_TYPES.has(object.type))
}

export function normalizeCameraMount(mount) {
  if (!mount || typeof mount !== 'object' || !String(mount.targetId || '')) return null
  return {
    targetId: String(mount.targetId),
    style: MOUNT_STYLES.has(mount.style) ? mount.style : 'integrated',
    offsetX: clampOffset(mount.offsetX),
  }
}

export function resolveCameraMount(mount, objects = []) {
  const normalized = normalizeCameraMount(mount)
  if (!normalized) return null
  return cameraMountTargets(objects).some(object => object.id === normalized.targetId)
    ? normalized
    : null
}

export function cameraPositionFromMount(mount, objects = []) {
  const resolved = resolveCameraMount(mount, objects)
  if (!resolved) return null
  const target = objects.find(object => object.id === resolved.targetId)
  return {
    col: Math.max(0, Math.min(1, Number(target.col) + resolved.offsetX * .12)),
    row: Math.max(0, Math.min(1, Number(target.row) - (resolved.style === 'top' ? .24 : .2))),
  }
}

export function defaultCameraMount(objects = []) {
  const targets = cameraMountTargets(objects)
  const target = targets.find(object => object.role === 'primary_screen') || targets[0]
  return target ? { targetId: target.id, style: 'integrated', offsetX: 0 } : null
}
