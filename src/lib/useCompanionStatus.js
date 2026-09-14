import { useEffect, useRef, useState } from 'react'
import { fetchCompanionDebug } from './nativeCompanion'
import { UNCHECKED_COMPANION_STATUS, companionStatusFromDebug, nextPermissionLatch } from './protectionReadiness'

// Polls the native Companion so protection claims reflect whether rules can be
// enforced right now. Disabled callers never touch native IPC, and a result is
// never carried across a disabled period: re-enabling starts from unchecked,
// so a Companion that quit in the meantime can't flash as ready. Permission
// reports are latched across polls (see nextPermissionLatch) so the claim does
// not flip as the user switches between apps.
export function useCompanionStatus({ enabled = true, intervalMs = 10000 } = {}) {
  const [status, setStatus] = useState(UNCHECKED_COMPANION_STATUS)
  const permissionLatchRef = useRef({})

  useEffect(() => {
    if (!enabled) {
      permissionLatchRef.current = {}
      setStatus(UNCHECKED_COMPANION_STATUS)
      return undefined
    }
    let cancelled = false
    const check = async () => {
      const debug = await fetchCompanionDebug()
      if (cancelled) return
      permissionLatchRef.current = nextPermissionLatch(permissionLatchRef.current, debug, Date.now())
      setStatus(companionStatusFromDebug(debug, permissionLatchRef.current))
    }
    check()
    const interval = window.setInterval(check, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled, intervalMs])

  return enabled ? status : UNCHECKED_COMPANION_STATUS
}
