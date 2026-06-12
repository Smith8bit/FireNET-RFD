import { useState } from 'react'
import { useSocketStore } from '../functions/stateStore'
import { formatDate, formatTime } from '../functions/datetime'

export default function ExpandedCard({ fire, officers }) {
    const [selectedOfficer, setSelectedOfficer] = useState('')
    const send = useSocketStore((s) => s.send)

    return (
        <div id="container" className="bg-white w-full flex-1 min-h-0 flex flex-col px-4">
            <div id="detail" className="no-scrollbar border-b-2 border-gray-300 pb-4 pt-2">
                <div className="flex items-start justify-between gap-2">
                    <h2 className="text-2xl font-bold leading-tight">{fire.name}</h2>
                    <span
                        className={`shrink-0 mt-0.5 px-2.5 py-1 rounded-full text-sm font-semibold ${
                            fire.status
                                ? 'bg-gray-200 text-gray-600'
                                : fire.booked
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                        }`}
                    >
                        {fire.status ? 'ดับแล้ว' : fire.booked ? 'ถูกจอง' : 'ลุกไหม้'}
                    </span>
                </div>

                <dl className="mt-3 space-y-1.5 text-md">
                    <div className="flex justify-between gap-2">
                        <dt className="min-w-fit shrink-0 text-gray-500">ชนิดพื้นที่</dt>
                        <dd className="text-gray-900 font-medium text-right">{fire.type || '-'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                        <dt className="min-w-fit shrink-0 text-gray-500">ตรวจพบเมื่อ</dt>
                        <dd className="text-gray-900 font-medium text-right">{formatDate(fire.date, fire.time)} {formatTime(fire.date, fire.time)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                        <dt className="min-w-fit shrink-0 text-gray-500">ที่ตั้ง</dt>
                        <dd className="text-gray-900 font-medium text-right">
                            {[fire.tumboon, fire.aumper, fire.province].filter(Boolean).join(' · ') || '-'}
                        </dd>
                    </div>
                </dl>
            </div>

            <div id="available-officers" className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar pb-2 border-b-2 border-gray-300">
                <p className="sticky top-0 z-10 bg-white py-2 text-md font-semibold text-gray-500">เจ้าหน้าที่ในพื้นที่</p>
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
                                <span className="font-medium text-md">{o.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {o.active ? 'ออนไลน์' : 'ออฟไลน์'}
                                </span>
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">{o.province_name_th}</p>
                        </button>
                    ))  
                )}
            </div>

            <div id="actions" className="py-2 flex gap-2">
                <button
                    disabled={!selectedOfficer}
                    className="py-3 px-5 font-bold text-lg text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setSelectedOfficer('')}
                >
                    ล้าง
                </button>
                <button
                    disabled={!selectedOfficer}
                    className="flex-1 py-3 text-white font-bold text-lg border rounded-lg bg-forest-500 hover:bg-forest-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    onClick={() => send({ type: 'appoint_officer', fire_id: fire.id, officer_id: selectedOfficer })}
                >
                    มอบหมายเจ้าหน้าที่
                </button>
            </div>
        </div>
    )
}
