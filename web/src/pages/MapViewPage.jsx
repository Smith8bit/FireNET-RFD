import { useLocation } from 'react-router-dom'
import { useSocketStore } from '../functions/SocketStore'

export default function MapViewPage() {

  const send = useSocketStore((s) => s.send)
  const ready = useSocketStore((s) => s.ready)
  const msg = useSocketStore((s) => s.lastMessage)

  const location = useLocation()
  const url = location.pathname + location.search

  return (
    <div>
      <h1>Map View Page</h1>
      <button
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        onClick={() => send({ link: url })}>
        Send Message
      </button>
      {/* Add your map view content here */}
    </div>
  )
}