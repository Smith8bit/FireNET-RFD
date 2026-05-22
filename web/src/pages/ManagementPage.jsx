import { useLocation } from 'react-router-dom'
import { useSocketStore } from '../functions/SocketStore' 

export default function ManagementPage() {

  const send = useSocketStore((s) => s.send)
  const ready = useSocketStore((s) => s.ready)
  const msg = useSocketStore((s) => s.lastMessage)

  const location = useLocation()
  const url = location.pathname + location.search
  
  return (
    <div>
      <h1>Management Page</h1>
      <button onClick={() => send({ link: url })}>
        Send Message
      </button>
      {/* Add your management content here */}
    </div>
  )
}