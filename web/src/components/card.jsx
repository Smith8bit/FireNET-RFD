import { useHoverStore } from '../functions/stateStore'
import { useEffect } from 'react'

export default function Card({ Title, Type, Date, Time, Officer=0}) {
    
    const hoveredMarker = useHoverStore((s) => s.hoveredMarker);
    const set = useHoverStore((s) => s.setHoveredMarker);
    
    useEffect(() => {
        console.log(hoveredMarker)
    }, [hoveredMarker])

    return (
        <div className="bg-white rounded-lg shadow-md p-4 w-full h-fit mb-4 text-left"
            onMouseEnter={() => set({ Title, Type, Date, Time, Officer })}
            onMouseLeave={() => set(null)}
        >
            <p className="text-black text-xl font-bold mb-2">{Title}</p>
            <p className="text-gray-700 text-base mb-1">ประเภท: {Type}</p>
            <p className="text-gray-700 text-base mb-1">{Date} - {Time}</p>
        </div>
    );
}
