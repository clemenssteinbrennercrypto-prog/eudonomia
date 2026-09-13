import { useEffect, useState } from 'react'
import { fetchCompanionDebug } from './nativeCompanion'
import { UNCHECKED_COMPANION_STATUS, companionStatusFromDebug } from './protectionReadiness'

// Polls the native Companion so protection claims reflect whether rules can be
// enforced right now. Disabled callers never touch native IPC.
export function useCompanionStatus({ enabled = true, intervalMs = 10000 } = {}) {
  const [status, setStatus] = useState(UNCHECKED_COMPANION_STATUS)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const check = async () => {
      const debug = await fetchCompanionDebug()
      if (!cancelled) setStatus(companionStatusFromDebug(debug))
    }
    check()
    const interval = window.setInterval(check, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [enabled, intervalMs])

  return status
}
