import { useMapSelection } from '../functions/stateStore'

export default function Card({ Title, Type, Date, Time, id }) {
    const setHovered = useMapSelection((s) => s.setHovered)
    const setFocused = useMapSelection((s) => s.setFocused)

    return (
        <div
            className="bg-white rounded-lg shadow-md p-4 w-full h-fit mb-4 text-left"
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setFocused(id)}
        >
            <p className="text-black text-xl font-bold mb-2">{Title}</p>
            <p className="text-gray-700 text-base mb-1">ประเภท: {Type}</p>
            <p className="text-gray-700 text-base mb-1">{Date} - {Time}</p>
        </div>
    )
}
