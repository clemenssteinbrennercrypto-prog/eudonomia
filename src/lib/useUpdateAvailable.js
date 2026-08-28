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

export async function runNativeReload({ invoke, reload, onState }) {
  onState?.({ installing: true, error: null })
  try {
    const result = await invoke('install_native_update')
    if (result?.installed) return { installed: true, reloaded: false }
    if (result?.error) {
      onState?.({ installing: false, error: result.error })
      return { installed: false, reloaded: false, error: result.error }
    }
    reload()
    return { installed: false, reloaded: true }
  } catch (error) {
    const message = error?.message || String(error)
    onState?.({ installing: false, error: message })
    return { installed: false, reloaded: false, error: message }
  }
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

  const reloadOrUpdate = useCallback(async () => {
    const invoke = getTauriInvoke()
    if (!invoke) {
      window.location.reload()
      return
    }
    if (installingRef.current) return

    installingRef.current = true
    await runNativeReload({
      invoke,
      reload: () => window.location.reload(),
      onState: patch => setStatus(prev => ({ ...prev, ...patch })),
    })
    if (document.visibilityState === 'visible') {
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
    reloadOrUpdate,
    reloadCurrentApp: () => window.location.reload(),
  }
}
