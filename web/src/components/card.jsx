import { useMapSelection } from '../functions/stateStore'

export default function Card({ Title, Area, Date, Time, id, status, booked }) {
    const setHovered = useMapSelection((s) => s.setHovered)
    const setFocused = useMapSelection((s) => s.setFocused)

    // same states/colors as the mobile fire list
    const label = status ? 'ดับแล้ว' : booked ? 'ถูกจอง' : 'ว่าง'
    const free = !status && !booked

    return (
        <div
            className="flex items-center justify-between bg-white hover:bg-forest-100 hover:border-forest-600 shadow-md p-4 border-b border-gray-300 w-full h-fit text-left transition-colors duration-150 cursor-pointer"
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setFocused(id)}
        >
            <div className="min-w-0">
                <p className="text-black text-xl font-bold mb-2 truncate">{Title}</p>
                <p className="text-gray-700 text-base mb-1">ชนิดพื้นที่: {Area}</p>
                <p className="text-gray-700 text-base mb-1">เวลาที่ตรวจพบ: {Date} - {Time}</p>
            </div>
            <span
                className={`ml-3 px-4 py-1 rounded-full text-sm font-semibold text-white shrink-0 ${
                    free ? 'bg-amber-500' : 'bg-gray-300'
                }`}
            >
                {label}
            </span>
        </div>
    )
}
