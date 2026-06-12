import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? ''
const PAGE_SIZE = 20

const ACTION_LABELS = {
  'fire.reserve': 'จองจุดไฟ',
  'fire.release': 'ยกเลิกการจอง',
  'fire.resolve': 'ดับไฟสำเร็จ',
  'fire.appoint': 'มอบหมายเจ้าหน้าที่',
  'fire.expire': 'หมดอายุอัตโนมัติ',
  'fire.ingest': 'นำเข้าข้อมูลดาวเทียม',
  'officer.verify': 'ยืนยันเจ้าหน้าที่',
  'officer.update': 'แก้ไขข้อมูลเจ้าหน้าที่',
  'officer.online': 'เข้าปฏิบัติงาน',
  'officer.offline': 'ออกปฏิบัติงาน',
  'region.assign': 'กำหนดสิทธิ์พื้นที่',
  'region.revoke': 'ถอนสิทธิ์พื้นที่',
  'auth.login': 'เข้าสู่ระบบ',
  'auth.register': 'สมัครบัญชี',
}

const ACTION_COLORS = {
  fire: 'bg-orange-100 text-orange-700',
  officer: 'bg-blue-100 text-blue-700',
  region: 'bg-purple-100 text-purple-700',
  auth: 'bg-gray-100 text-gray-600',
}

const AT_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

function summarize(item) {
  const d = item.detail ?? {}
  switch (item.action) {
    case 'fire.ingest':
      return `ดึงข้อมูล ${d.fetched ?? 0} รายการ · เพิ่มใหม่ ${d.inserted ?? 0}`
    case 'fire.expire':
      return `${d.count ?? 0} รายการ`
    case 'fire.reserve':
    case 'fire.resolve':
    case 'fire.appoint':
      return d.name ?? ''
    case 'officer.verify':
      return [d.name, d.email].filter(Boolean).join(' · ')
    case 'officer.update':
      return [d.name, d.province_path && `→ ${d.province_path}`].filter(Boolean).join(' · ')
    case 'region.assign':
    case 'region.revoke':
      return [d.role, d.region_path].filter(Boolean).join(' · ')
    default:
      return ''
  }
}

export default function AuditTrail() {
  const [items, setItems] = useState(null) // null = loading
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [error, setError] = useState(null)
  const [action, setAction] = useState('')
  const [onDate, setOnDate] = useState('')
  const [actorInput, setActorInput] = useState('')
  const [actor, setActor] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    })
    if (action) params.set('action', action)
    if (actor) params.set('actor', actor)
    if (onDate) {
      const start = new Date(`${onDate}T00:00:00`)
      params.set('since', start.toISOString())
      params.set('until', new Date(start.getTime() + 86_400_000).toISOString())
    }
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/audit?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
        setError(null)
      } catch (e) {
        console.warn('[AuditTrail] load failed:', e)
        if (cancelled) return
        setItems([])
        setError('โหลดประวัติไม่สำเร็จ')
      }
    })()
    return () => { cancelled = true }
  }, [page, action, actor, onDate, reload])

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-gray-300">
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
        >
          <option value="">ทุกเหตุการณ์</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          type="date"
          value={onDate}
          onChange={(e) => { setOnDate(e.target.value); setPage(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
        />
        <form
          onSubmit={(e) => { e.preventDefault(); setActor(actorInput.trim()); setPage(0) }}
          className="flex-1 min-w-40"
        >
          <input
            type="text"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            onBlur={() => { setActor(actorInput.trim()); setPage(0) }}
            placeholder="ค้นหาด้วยอีเมลผู้กระทำ…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
          />
        </form>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="text-sm text-forest-700 hover:text-forest-600 px-2 py-1.5"
        >
          รีเฟรช
        </button>
      </div>

      {items === null && <p className="text-gray-500">กำลังโหลด…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {items !== null && !error && items.length === 0 && (
        <p className="text-gray-500">ไม่พบประวัติ</p>
      )}

      <div className="overflow-y-auto max-h-96 no-scrollbar">
        <ul className="space-y-2">
          {(items ?? []).map((item) => (
            <li key={item.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2.5">
              <div className="min-w-0">
                <p className="font-medium flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACTION_COLORS[item.action.split('.')[0]] ?? 'bg-gray-100 text-gray-600'}`}>
                    {ACTION_LABELS[item.action] ?? item.action}
                  </span>
                  <span className="text-sm text-gray-700 truncate">{summarize(item)}</span>
                </p>
                <p className="text-sm text-gray-500 truncate">
                  {item.actor_email === 'system' ? 'ระบบ' : item.actor_email}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap ml-3">
                {AT_FORMAT.format(new Date(item.at))} น.
              </span>
            </li>
          ))}
        </ul>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-3 text-sm text-gray-600">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={page === 0}
            className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            ก่อนหน้า
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} จาก {total}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
            disabled={page >= lastPage}
            className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            ถัดไป
          </button>
        </div>
      )}
    </div>
  )
}
