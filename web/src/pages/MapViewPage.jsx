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
        className="text-white bg-brand box-border border border-transparent hover:bg-brand-strong focus:ring-4 focus:ring-brand-medium shadow-xs font-medium leading-5 rounded-full text-sm px-4 py-2.5 focus:outline-none"
        onClick={() => send({ link: url })}>
        Send Message
      </button>
      {/* Add your map view content here */}
    </div>
  )
}