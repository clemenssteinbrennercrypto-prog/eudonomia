import { useEffect, useReducer } from 'react'

// Calendar views must advance even when history and settings do not change.
// Refresh immediately on return from a hidden/sleeping WebView as well.
export function useCurrentTime() {
  const [, refresh] = useReducer(value => value + 1, 0)
  useEffect(() => {
    const update = () => refresh()
    const timer = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return Date.now()
}
