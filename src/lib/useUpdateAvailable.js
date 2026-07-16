import { useCallback, useEffect, useState } from 'react'

const CURRENT_BUILD_ID = __EUDAIMONIA_BUILD_ID__
const CHECK_INTERVAL_MS = 5 * 60 * 1000

function getBuildInfoUrl() {
  const base = import.meta.env.BASE_URL || '/'
  const url = new URL(`${base}build-info.json`, `${window.location.origin}/`)
  url.searchParams.set('t', Date.now().toString())
  return url.toString()
}

export function useUpdateAvailable() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  const checkForUpdate = useCallback(async () => {
    if (updateAvailable || import.meta.env.DEV) return

    try {
      const response = await fetch(getBuildInfoUrl(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!response.ok) return

      const remoteBuild = await response.json()
      if (remoteBuild?.buildId && remoteBuild.buildId !== CURRENT_BUILD_ID) {
        setUpdateAvailable(true)
      }
    } catch {
      // Update checks are best-effort and should never interrupt app use.
    }
  }, [updateAvailable])

  useEffect(() => {
    checkForUpdate()

    const intervalId = window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkForUpdate])

  return updateAvailable
}
