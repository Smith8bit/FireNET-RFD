import forestImage from '../assets/forest.jpg'
import { useState } from 'react'
import { useSocketStore } from '../functions/stateStore'

export default function ExpandedCard({ fire, officers }) {
    const [selectedOfficer, setSelectedOfficer] = useState('')
    const send = useSocketStore((s) => s.send)

    return (
        <div id="container" className="bg-white w-full h-full px-3 flex flex-col overflow-hidden">
            <div id="detail" className="border-0 rounded-t-3xl overflow-clip no-scrollbar border-b-2 border-gray-300">
                <img
                    src={forestImage}
                    alt="Forest"
                    className="w-full h-30 object-cover"
                />
                <div className="pl-2 py-3">
                    <h2 className="text-xl font-bold mt-2">{fire.name}</h2>
                    <p>ประเภท: {fire.type}</p>
                    <p>วันที่ตรวจพบ: {fire.date}</p>
                    <p>เวลา: {fire.time}</p>
                    <p>ตำบล: {fire.tumboon}</p>
                    <p>อำเภอ: {fire.aumper}</p>
                    <p>จังหวัด: {fire.province}</p>
                </div>
            </div>

            <div id="available-officers" className="flex-1 overflow-y-auto no-scrollbar py-2 border-b-2 border-gray-300">
                <p className="text-sm font-semibold text-gray-500 mb-2">เจ้าหน้าที่ในพื้นที่</p>
                {officers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">ไม่มีเจ้าหน้าที่</p>
                ) : (
                    officers.map((o) => (
                        <button
                            key={o.field_officer_id}
                            onClick={() => setSelectedOfficer(o.field_officer_id)}
                            className={`w-full text-left px-3 py-2 mb-1 rounded-lg border transition-colors ${
                                selectedOfficer === o.field_officer_id
                                    ? 'bg-forest-100 border-forest-500'
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">{o.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {o.active ? 'ปฏิบัติงาน' : 'ว่าง'}
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{o.province_name_th}</p>
                        </button>
                    ))
                )}
            </div>

            <div id="actions" className="py-2 flex justify-center">
                <button
                    disabled={!selectedOfficer}
                    className="w-full py-3 text-white font-bold text-lg border rounded-lg bg-forest-500 hover:bg-forest-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    onClick={() => send({ type: 'appoint_officer', fire_id: fire.id, officer_id: selectedOfficer })}
                >
                    มอบหมายเจ้าหน้าที่
                </button>
            </div>
        </div>
    )
}
