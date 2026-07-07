import { useEffect, useRef } from 'react'

/**
 * Run `handler` exactly once for each new value of `msg`. Used to react to one-shot
 * signals (e.g. a server message or nav flag) without the handler re-firing on every
 * unrelated re-render.
 * @param {*} msg  The trigger value; a change to a truthy, different value fires the handler.
 * @param {(msg: *) => void} handler  Side-effect to run for the new message.
 * @remarks Seeded with the initial `msg` so the value already present on mount is
 *   treated as "already seen" and does not fire. The ref, not state, holds the last
 *   seen value so updating it never causes a re-render.
 */
export function useMessageEffect(msg, handler) {
  const seen = useRef(msg)
  useEffect(() => {
    if (msg && msg !== seen.current) {
      seen.current = msg
      handler(msg)
    }
  }, [msg, handler])
}
