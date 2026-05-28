import { useLocation } from 'react-router-dom'
import { useSocketStore } from '../functions/stateStore'

export default function ManagementPage() {
  const send = useSocketStore((s) => s.send)
  const location = useLocation()
  const url = location.pathname + location.search

  return (
    <div>
      <h1>Management Page</h1>
      <button onClick={() => send({ link: url })}>
        Send Message
      </button>
    </div>
  )
}
