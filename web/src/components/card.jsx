import { useMapSelection } from '../lib/stateStore'
import { formatDate, formatTime } from '../lib/datetime'

/**
 * Card
 * Compact list-row representation of a single fire, shown in the sidebar
 * list that mirrors the map's fire markers. Hovering/clicking a card syncs
 * the shared `useMapSelection` store so the map can highlight/fly to the
 * same fire (and vice versa).
 *
 * @param {object} props
 * @param {string} props.Title - fire name/title
 * @param {string} props.Area - area/land-type label (e.g. forest, farmland)
 * @param {string|Date} props.Date - detection date, passed through to `formatDate`/`formatTime`
 * @param {string|Date} props.Time - detection time, passed through to `formatDate`/`formatTime`
 * @param {string|number} props.id - fire identifier used for hover/focus selection
 * @param {boolean} props.status - true when the fire has been resolved/extinguished
 * @param {boolean} props.booked - true when an officer has already been assigned
 * @returns {JSX.Element} a clickable row summarizing the fire's status and details
 *
 * Status precedence is resolved -> booked -> free (unclaimed), which drives
 * both the Thai status label and the row's background color.
 */
export default function Card({ Title, Area, Date, Time, id, status, booked }) {
    const setHovered = useMapSelection((s) => s.setHovered)
    const setFocused = useMapSelection((s) => s.setFocused)

    const label = status ? 'ดับแล้ว' : booked ? 'ถูกจอง' : 'ลุกไหม้'
    const free = !status && !booked

    return (

        <div
            className={`group flex items-center shadow-md border-b-2 border-gray-300 hover:border-brand w-full h-full text-left transition-colors duration-150 cursor-pointer ${free ? 'bg-red-400' : booked ? 'bg-amber-400' : 'bg-gray-200'
                }`}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setFocused(id)}
        >
            <span
                className='flex items-center justify-center p-1 shrink-0 text-center text-md h-full font-semibold text-white'
            >
                {label}
            </span>
            <div className="min-w-0 bg-foreground w-full h-full py-4 px-6 rounded-l-xl group-hover:bg-flame-light">
                <p className="text-black text-xl font-bold mb-0.5">{Title}</p>
                <p className="text-gray-500 text-base font-head font-light truncate">
                    วันที่: {formatDate(Date, Time)}
                </p>
                <p className="text-gray-500 text-base font-head font-light truncate">
                    เวลา:   {formatTime(Date, Time)}
                </p>
                <p className="text-gray-500 text-base font-head font-light truncate">ชนิดพื้นที่: {Area}</p>
            </div>
        </div>
    )
}
