import { useEffect, useRef } from 'react'

/**
 * Run `handler` once for every *new* socket message frame, ignoring whatever was
 * already in the store when the component mounted. Use this for action-outcome
 * frames (e.g. `officer_updated`, `error`) so a stale result from a previous
 * screen never re-fires (e.g. a toast flashing) when a component mounts.
 *
 * Data-snapshot frames (lists the component must render on mount) should use a
 * plain effect instead — they intentionally apply the last value seen.
 */
export function useMessageEffect(msg, handler) {
  // initialised to whatever was already in the store, so the first effect run
  // (mount) sees msg === seen and skips — only genuinely new frames fire.
  const seen = useRef(msg)
  useEffect(() => {
    if (msg && msg !== seen.current) {
      seen.current = msg
      handler(msg)
    }
    // `handler` is intentionally a dep: callers pass inline closures, so the
    // effect re-runs each render, but the `seen` guard keeps it single-fire.
  }, [msg, handler])
}
