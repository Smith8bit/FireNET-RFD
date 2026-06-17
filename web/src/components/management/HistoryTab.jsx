import { useEffect, useState } from 'react'
import { API_URL } from './shared'

const FMT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})
const fmt = (iso) => `${FMT.format(new Date(iso))} น.`

// Resolved-fire history with the officer's evidence (note, photos, who, when).
export default function HistoryTab() {
  const [items, setItems] = useState(null) // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/fires/resolutions`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) { setItems(data); setError(null) }
      } catch (e) {
        console.warn('[HistoryTab] load failed:', e)
        if (!cancelled) { setItems([]); setError('โหลดประวัติไม่สำเร็จ') }
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (items === null) return <p className="text-gray-500">กำลังโหลด…</p>
  if (error) return <p className="text-red-600">{error}</p>
  if (items.length === 0) return <p className="text-gray-500">ยังไม่มีประวัติการดับไฟ</p>

  return (
    <div className="overflow-y-auto max-h-[32rem] no-scrollbar space-y-2">
      {items.map((it) => (
        <div key={it.fire_id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{it.name}</p>
              <p className="text-sm text-gray-500">{it.province ?? '-'}</p>
            </div>
            <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${it.false_alarm ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
              {it.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}
            </span>
          </div>
          <dl className="mt-2 text-sm text-gray-600 space-y-0.5">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">ดับโดย</dt>
              <dd>{it.officer_name ?? 'ไม่ทราบ'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-400">เวลาดับ</dt>
              <dd>{fmt(it.resolved_at)}</dd>
            </div>
          </dl>
          {it.note && <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{it.note}</p>}
          {it.image_ids.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {it.image_ids.map((id) => (
                <a key={id} href={`${API_URL}/fires/${it.fire_id}/images/${id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${API_URL}/fires/${it.fire_id}/images/${id}`}
                    alt="หลักฐาน"
                    className="h-20 w-20 object-cover rounded-lg border border-gray-200"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
