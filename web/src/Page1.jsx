// Page1.jsx
import { useSocketStore } from './functions/SocketStore'

function Page1() {
  const msg = useSocketStore((s) => s.lastMessage)
  const send = useSocketStore((s) => s.send)
  const isReady = useSocketStore((s) => s.isReady)

  // only react to messages meant for this page
  const mine = msg?.type === 'page1' ? msg : null

  return (
    <section>
      <h2>Page 1</h2>
      <button
        type="button"
        disabled={!isReady}
        onClick={() => send({ type: 'page1', text: 'Hello from Page 1' })}
      >
        Send from Page 1
      </button>
      <p>{mine ? JSON.stringify(mine) : 'No message for Page 1 yet'}</p>
    </section>
  )
}

export default Page1