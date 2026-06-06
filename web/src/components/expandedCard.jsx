import { useSocketStore } from '../functions/stateStore'
import forestImage from '../assets/forest.jpg'
import { useState } from 'react'

export default function ExpandedCard({ fire }) {
    const send = useSocketStore((s) => s.send)
    const [selectedOfficer, setSelectedOfficer] = useState('')
    return (
        <div id="container" className="bg-white w-full h-full px-3 flex flex-col">
            <div id="detail"
                className="border-0 rounded-t-3xl max-h-fit overflow-clip no-scrollbar flex-1 border-b-2 border-gray-300"
            >
                <img
                    src={forestImage}
                    alt="Forest"
                    className="w-full h-30 object-cover "
                />
                <div className="pl-2 py-3 ">
                    <h2 className="text-xl font-bold mt-2">{fire.name}</h2>
                    <p>ประเภท: {fire.type}</p>
                    <p>วันที่ตรวจพบ: {fire.date}</p>
                    <p>เวลา: {fire.time}</p>
                    <p>ตำบล: {fire.tumboon}</p>
                    <p>อำเภอ: {fire.aumper}</p>
                    <p>จังหวัด: {fire.province}</p>
                </div>
            </div>
            <div id="available-officers"
                className="overflow-y-scroll no-scrollbar flex-col max-h-5 border-b-2 border-gray-300 "
            >
                LIST OF OFFICERS PLACEHOLDER
            </div>
            <div id="actions"
                className="mt-auto py-2 flex justify-center"
            >
                <button
                    className="w-full py-3 text-white font-bold text-lg border rounded-lg bg-forest-500 hover:bg-forest-700 transition-colors"
                    onClick={() => send({ "ACTION": "APPOINT", "FIRE": fire.id, "OFFICER" : selectedOfficer})}
                >
                    มอบหมายเจ้าหน้าที่
                </button>
            </div>
        </div>
    )
}
