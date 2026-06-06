import { useMapSelection } from '../functions/stateStore'

export default function Card({ Title, Area, Date, Time, id }) {
    const setHovered = useMapSelection((s) => s.setHovered)
    const setFocused = useMapSelection((s) => s.setFocused)

    return (
        <div
            className="bg-white hover:bg-forest-100 hover:border-forest-600 shadow-md p-4 border-b border-gray-300 w-full h-fit text-left transition-colors duration-150 cursor-pointer"
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setFocused(id)}
        >
            <p className="text-black text-xl font-bold mb-2">{Title}</p>
            <p className="text-gray-700 text-base mb-1">ชนิดพื้นที่: {Area}</p>
            <p className="text-gray-700 text-base mb-1">{Date} - {Time}</p>
        </div>
    )
}
