import { useSocketStore } from '../functions/stateStore'

export default function ExpandedCard({ fire }) {
    const send = useSocketStore((s) => s.send)

    return (
        <div id="container" className="bg-white w-full h-full p-4">
            <p className="text-xl font-bold">{fire?.title}</p>
            <p>Lan: {fire?.lat} Long: {fire?.lng}</p>
            <button
                className="px-4 py-2 bg-blue-500 text-white rounded"
                onClick={() => send({ msg: 'Hello @ ' + fire?.lat })}
            >
                SEND
            </button>
        </div>
    )
}
