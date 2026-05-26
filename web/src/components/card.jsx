import { useHoverStore } from '../functions/stateStore'
import { useEffect } from 'react'

export default function Card({ Title, Type, Date, Time, Officer=0, id}) {
    
    const markerId = Date + Time + Title
    const hoveredTitle = useHoverStore((s) => s.hoveredMarker?.id === id ? markerId : null);
    const setHoveredMarker = useHoverStore((s) => s.setHoveredMarker);
    
    useEffect(() => {
        console.log(hoveredTitle)
    }, [hoveredTitle])

    return (
        <div className="bg-white rounded-lg shadow-md p-4 w-full h-fit mb-4 text-left"
            onMouseEnter={() => setHoveredMarker({Title, id})}
            onMouseLeave={() => setHoveredMarker(null)}
        >
            <p className="text-black text-xl font-bold mb-2">{Title}</p>
            <p className="text-gray-700 text-base mb-1">ประเภท: {Type}</p>
            <p className="text-gray-700 text-base mb-1">{Date} - {Time}</p>
        </div>
    );
}
