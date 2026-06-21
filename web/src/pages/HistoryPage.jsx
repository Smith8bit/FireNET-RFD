import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore, can } from '../lib/useAuthStore'
import { API_URL } from '../lib/shared'

const PAGE_SIZE = 20

const FMT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

// Resolved-fire history with the officer's evidence (note, photos, who, when).
export default function HistoryPage() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState(null) // null = loading
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [kind, setKind] = useState('') // '' = all, 'false' = real fire, 'true' = false alarm
  const [onDate, setOnDate] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
    if (kind) params.set('false_alarm', kind)
    if (onDate) {
      const start = new Date(`${onDate}T00:00:00`)
      params.set('since', start.toISOString())
      params.set('until', new Date(start.getTime() + 86_400_000).toISOString())
    }
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/fires/resolutions?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
        setError(null)
      } catch (e) {
        console.warn('[HistoryPage] load failed:', e)
        if (cancelled) return
        setItems([])
        setError('โหลดประวัติไม่สำเร็จ')
      }
    })()
    return () => { cancelled = true }
  }, [page, kind, onDate])

  if (!can(user, 'fires.history')) return <Navigate to="/" replace />

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0)
  return (
    <div className="py-2 h-screen flex flex-col gap-2 w-1/2 self-center overflow-y-hidden">
      <div className="bg-white border-0 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-brand font-title">ประวัติการดับไฟ</h2>
      </div>
      <div className="flex-1 bg-white border-0 rounded-2xl p-6 mb-1 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-gray-300">
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value); setPage(0) }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
          >
            <option value="">ทั้งหมด</option>
            <option value="false">ดับแล้ว</option>
            <option value="true">ไม่ใช่ไฟ</option>
          </select>
          <input
            type="date"
            value={onDate}
            onChange={(e) => { setOnDate(e.target.value); setPage(0) }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
          />
        </div>

        {items === null && <p className="text-gray-500">กำลังโหลด…</p>}
        {error && <p className="text-red-600">{error}</p>}
        {items !== null && !error && items.length === 0 && (
          <p className="text-gray-500">ยังไม่มีประวัติการดับไฟ</p>
        )}

        {items !== null && !error && items.length > 0 && (
          <div className="overflow-y-auto min-h-96 max-h-96 no-scrollbar">
            <table className="w-full text-sm border-collapse table-fixed">
              <colgroup>
                <col className="w-32" />
                <col className="w-48" />
                <col className="w-28" />
                <col />
                <col className="w-32" />
              </colgroup>
              <thead>
                <tr className="text-xs font-medium text-gray-400 text-left border-b border-gray-200">
                  <th className="px-3 py-2 font-medium">จุดไฟ</th>
                  <th className="px-3 py-2 font-medium">ที่ตั้ง</th>
                  <th className="px-3 py-2 font-medium">ดับโดย</th>
                  <th className="px-3 py-2 font-medium">รายละเอียด</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">เวลาดับ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.fire_id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2.5 align-top">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${it.false_alarm ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                        {it.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}
                      </span>
                      <p className="mt-1 font-medium text-gray-900">{it.name}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top text-gray-600 wrap-break-word">
                      {[it.tumboon, it.aumper, it.province].filter(Boolean).join(' · ') || '-'}
                    </td>
                    <td className="px-3 py-2.5 align-top text-gray-600 break-all">
                      {it.officer_name ?? 'ไม่ทราบ'}
                    </td>
                    <td className="px-3 py-2.5 align-top text-gray-700 whitespace-pre-line wrap-break-word">
                      {it.note || '—'}
                      {it.image_ids.length > 0 && (
                        <div className="mt-1 flex gap-1.5 flex-wrap">
                          {it.image_ids.map((id) => (
                            <a key={id} href={`${API_URL}/fires/${it.fire_id}/images/${id}`} target="_blank" rel="noreferrer">
                              <img
                                src={`${API_URL}/fires/${it.fire_id}/images/${id}`}
                                alt="หลักฐาน"
                                className="h-16 w-16 object-cover rounded-lg border border-gray-200"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs text-gray-400 whitespace-nowrap text-right">
                      {FMT.format(new Date(it.resolved_at))} น.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {items?.length > 0 && (
          <div className="flex items-center justify-between pt-3 text-sm text-gray-600">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                หน้าแรก
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                ก่อนหน้า
              </button>
            </div>
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} จาก {total}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
                disabled={page >= lastPage}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                ถัดไป
              </button>
              <button
                type="button"
                onClick={() => setPage(lastPage)}
                disabled={page >= lastPage}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                หน้าสุดท้าย
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
