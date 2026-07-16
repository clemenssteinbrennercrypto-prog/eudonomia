import { useCallback, useEffect, useRef, useState } from 'react'

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

export function useAppUpdateStatus() {
  const [status, setStatus] = useState(() => ({
    ...DEFAULT_STATUS,
    runtime: getTauriInvoke() ? 'native' : 'web',
  }))
  const checkingRef = useRef(false)
  const installingRef = useRef(false)

  const checkForUpdate = useCallback(async () => {
    if (checkingRef.current) return

    const invoke = getTauriInvoke()

    if (invoke) {
      checkingRef.current = true
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
      } finally {
        checkingRef.current = false
      }
      return
    }

    setStatus(prev => ({
      ...prev,
      runtime: 'web',
      checking: false,
      installing: false,
      updateAvailable: false,
      updateVersion: null,
      currentVersion: null,
      error: null,
    }))
  }, [])

  const installNativeUpdate = useCallback(async () => {
    const invoke = getTauriInvoke()
    if (!invoke || installingRef.current) return

    installingRef.current = true
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
    } finally {
      installingRef.current = false
    }
  }, [])

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
