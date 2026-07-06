import { useEffect, useRef } from 'react'

export function useMessageEffect(msg, handler) {
  const seen = useRef(msg)
  useEffect(() => {
    if (msg && msg !== seen.current) {
      seen.current = msg
      handler(msg)
    }
  }, [msg, handler])
}
