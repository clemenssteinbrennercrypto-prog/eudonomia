import { useCallback, useEffect, useState } from 'react'

const CURRENT_BUILD_ID = __EUDAIMONIA_BUILD_ID__
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_STATUS = {
  runtime: 'web',
  checking: false,
  installing: false,
  updateAvailable: false,
  updateVersion: null,
  currentVersion: null,
  error: null,
}

function getTauriInvoke() {
  return window.__TAURI__?.core?.invoke || null
}

function getBuildInfoUrl() {
  const base = import.meta.env.BASE_URL || '/'
  const url = new URL(`${base}build-info.json`, `${window.location.origin}/`)
  url.searchParams.set('t', Date.now().toString())
  return url.toString()
}

export function useAppUpdateStatus() {
  const [status, setStatus] = useState(() => ({
    ...DEFAULT_STATUS,
    runtime: getTauriInvoke() ? 'native' : 'web',
  }))

  const checkForUpdate = useCallback(async () => {
    const invoke = getTauriInvoke()

    if (invoke) {
      setStatus(prev => ({ ...prev, runtime: 'native', checking: true, error: null }))

      try {
        const result = await invoke('check_native_update')
        setStatus(prev => ({
          ...prev,
          runtime: 'native',
          checking: false,
          updateAvailable: Boolean(result?.available),
          updateVersion: result?.version || null,
          currentVersion: result?.currentVersion || null,
          error: result?.error || null,
        }))
      } catch (error) {
        setStatus(prev => ({
          ...prev,
          runtime: 'native',
          checking: false,
          updateAvailable: false,
          updateVersion: null,
          error: error?.message || String(error),
        }))
      }
      return
    }

    if (status.updateAvailable || import.meta.env.DEV) return

    setStatus(prev => ({ ...prev, runtime: 'web', checking: true, error: null }))

    try {
      const response = await fetch(getBuildInfoUrl(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!response.ok) {
        setStatus(prev => ({ ...prev, checking: false }))
        return
      }

      const remoteBuild = await response.json()
      if (remoteBuild?.buildId && remoteBuild.buildId !== CURRENT_BUILD_ID) {
        setStatus(prev => ({
          ...prev,
          checking: false,
          updateAvailable: true,
          updateVersion: remoteBuild.buildId,
        }))
      } else {
        setStatus(prev => ({ ...prev, checking: false, updateAvailable: false }))
      }
    } catch (error) {
      // Update checks are best-effort and should never interrupt app use.
      setStatus(prev => ({
        ...prev,
        checking: false,
        error: error?.message || String(error),
      }))
    }
  }, [status.updateAvailable])

  const installNativeUpdate = useCallback(async () => {
    const invoke = getTauriInvoke()
    if (!invoke || status.installing) return

    setStatus(prev => ({ ...prev, installing: true, error: null }))

    try {
      const result = await invoke('install_native_update')
      setStatus(prev => ({
        ...prev,
        installing: false,
        updateAvailable: Boolean(result?.version && !result?.installed),
        updateVersion: result?.version || prev.updateVersion,
        error: result?.error || (result?.installed ? null : 'No native update is currently available.'),
      }))
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        installing: false,
        error: error?.message || String(error),
      }))
    }
  }, [status.installing])

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

  return {
    ...status,
    checkForUpdate,
    installNativeUpdate,
    reloadCurrentApp: () => window.location.reload(),
  }
}
