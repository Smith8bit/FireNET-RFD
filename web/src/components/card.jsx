import { useMapSelection } from '../functions/stateStore'
import { formatDate, formatTime } from '../functions/datetime'

export default function Card({ Title, Area, Date, Time, id, status, booked }) {
    const setHovered = useMapSelection((s) => s.setHovered)
    const setFocused = useMapSelection((s) => s.setFocused)

    // same states/colors as the mobile fire list
    const label = status ? 'ดับแล้ว' : booked ? 'ถูกจอง' : 'ลุกไหม้'
    const free = !status && !booked

    return (
        <div
            className="flex items-center bg-white hover:bg-forest-100 hover:border-forest-600 shadow-md px-4 py-0.5 border-b border-gray-300 w-full h-full text-left transition-colors duration-150 cursor-pointer"
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setFocused(id)}
        >
            <span
                className={`flex items-center justify-center shrink-0 w-12 self-stretch px-2 text-center text-sm font-semibold text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.3)] ${
                    free ? 'bg-red-400' : booked ? 'bg-amber-400' : 'bg-gray-300'
                }`}
            >
                {label}
            </span>
            <div className="min-w-0 px-4 py-3">
                <p className="text-black text-xl font-bold mb-1">{Title}</p>
                <p className="text-gray-700 text-base truncate">
                    วันที่: {formatDate(Date, Time)}
                </p>
                <p className="text-gray-700 text-base truncate">
                    เวลา:   {formatTime(Date, Time)}
                </p>
                <p className="text-gray-700 text-base mb-1 truncate">ชนิดพื้นที่: {Area}</p>
            </div>
        </div>
    )
}
