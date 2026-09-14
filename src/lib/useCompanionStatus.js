import { useEffect, useState } from 'react'
import { fetchCompanionDebug } from './nativeCompanion'
import { UNCHECKED_COMPANION_STATUS, companionStatusFromDebug } from './protectionReadiness'

// Polls the native Companion so protection claims reflect whether rules can be
// enforced right now. Disabled callers never touch native IPC, and a result is
// never carried across a disabled period: re-enabling starts from unchecked,
// so a Companion that quit in the meantime can't flash as ready. Permission
// memory belongs to the native Companion, where it survives screen changes and
// is resolved by an actual successful Automation call to the same target.
export function useCompanionStatus({ enabled = true, intervalMs = 10000 } = {}) {
  const [status, setStatus] = useState(UNCHECKED_COMPANION_STATUS)

  useEffect(() => {
    if (!enabled) {
      setStatus(UNCHECKED_COMPANION_STATUS)
      return undefined
    }
    let cancelled = false
    const check = async () => {
      const debug = await fetchCompanionDebug()
      if (cancelled) return
      setStatus(companionStatusFromDebug(debug))
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
