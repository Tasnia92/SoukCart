import { useEffect, type DependencyList } from 'react'

/**
 * Single knob for how often screens refresh themselves. Lower it for snappier
 * "live" updates; raise it to reduce load. Polling is used instead of realtime
 * (no Supabase / no sockets) since all writes flow through this app's own API.
 */
export const POLL_INTERVAL_MS = 20000

/**
 * Runs `callback` immediately, then re-runs it every `ms` (default
 * POLL_INTERVAL_MS) and on window focus. Cleans up on unmount.
 *
 * @param deps  Effect dependencies — re-run the timer whenever they change.
 */
export function usePoll(
  callback: () => void,
  deps: DependencyList = [],
  ms: number = POLL_INTERVAL_MS
) {
  useEffect(() => {
    callback()
    const id = window.setInterval(callback, ms)
    const onFocus = () => callback()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
    // deps intentionally drive the effect (including on mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
