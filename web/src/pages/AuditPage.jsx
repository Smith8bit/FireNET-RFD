import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../lib/useAuthStore'
import { apiFetch, INPUT_CLS, PAGE_SIZE, SELECT_CLS, THEAD_CLS } from '../lib/shared'
import { formatEventTime } from '../lib/datetime'
import { useRegions } from '../lib/useRegions'
import PaginationBar from '../components/PaginationBar'

const ACTION_LABELS = {
  'fire.reserve': 'จองจุดไฟ',
  'fire.resolve': 'ดับไฟสำเร็จ',
  'fire.false_report': 'แจ้งว่าไม่ใช่ไฟ',
  'fire.appoint': 'มอบหมายเจ้าหน้าที่',
  'fire.release': 'ยกเลิกการจอง',
  'fire.cancel_booking': 'ยกเลิกการมอบหมาย',
  'fire.expire': 'หมดอายุอัตโนมัติ',
  'fire.ingest': 'นำเข้าข้อมูลดาวเทียม',
  'officer.verify': 'ยืนยันเจ้าหน้าที่',
  'officer.update': 'แก้ไขข้อมูลเจ้าหน้าที่',
  'officer.online': 'เข้าปฏิบัติงาน',
  'officer.offline': 'ออกปฏิบัติงาน',
  'officer.delete': 'ลบเจ้าหน้าที่',
  'dispatcher.create': 'สร้างผู้ดูแล',
  'dispatcher.update': 'แก้ไขผู้ดูแล',
  'dispatcher.delete': 'ลบผู้ดูแล',
  'region_change.request': 'ขอย้ายพื้นที่',
  'region_change.approved': 'อนุมัติย้ายพื้นที่',
  'region_change.rejected': 'ปฏิเสธย้ายพื้นที่',
  'settings.location_poll': 'ตั้งค่ารอบส่งตำแหน่ง',
  'auth.login': 'เข้าสู่ระบบ',
  'auth.register': 'สมัครบัญชี',
  'auth.revoke_user': 'ระงับสิทธิ์ผู้ใช้',
  'auth.restore_user': 'คืนสิทธิ์ผู้ใช้',
}

const ACTION_COLORS = {
  fire: 'bg-orange-100 text-orange-700',
  officer: 'bg-blue-100 text-blue-700',
  dispatcher: 'bg-purple-100 text-purple-700',
  region_change: 'bg-teal-100 text-teal-700',
  settings: 'bg-amber-100 text-amber-700',
  auth: 'bg-gray-100 text-gray-600',
}

const CATEGORY_LABELS = {
  fire: 'จุดไฟ',
  officer: 'เจ้าหน้าที่',
  dispatcher: 'ผู้ดูแล',
  region_change: 'คำขอย้ายพื้นที่',
  settings: 'การตั้งค่า',
  auth: 'บัญชีผู้ใช้',
}

const provName = (names, path) => (path ? (names[path] ?? path) : path)

function summarize(item, names = {}) {
  const d = item.detail ?? {}
  const prov = (path) => provName(names, path)
  const arrowFrom = (prevPath) => (prevPath ? `${prov(prevPath)} → ` : '')
  const entity = (label, path) =>
    `${label}: ${d.name}\n สังกัด: ${d.division ?? '—'}\n ขอบเขต: ${prov(path)}`
  const renameParts = () => {
    const parts = []
    if (d.name) parts.push(`เปลี่ยนชื่อ: ${d.previous_name ? `${d.previous_name} → ` : ''}${d.name}`)
    if (d.username) parts.push(`เปลี่ยนชื่อผู้ใช้: ${d.previous_username ? `${d.previous_username} → ` : ''}${d.username}`)
    if ('division' in d) parts.push(`เปลี่ยนสังกัด: ${d.previous_division ? `${d.previous_division} → ` : ''}${d.division ?? '—'}`)
    return parts
  }

  switch (item.action) {
    case 'fire.ingest': {
      const base = `ดึงข้อมูล ${d.fetched ?? 0} รายการ · เพิ่มใหม่ ${d.inserted ?? 0}`
      const by = d.by_satellite
      return by
        ? `${base}\n${Object.entries(by).map(([s, n]) => `${s}: ${n}`).join(' · ')}`
        : base
    }
    case 'fire.expire':
      return `${d.count ?? 0} รายการ`
    case 'fire.reserve':
    case 'fire.resolve':
    case 'fire.false_report':
      return d.name ?? ''
    case 'fire.appoint':
      return d.officer_name ? `${d.name ?? ''} → ${d.officer_name}` : (d.name ?? '')
    case 'fire.release':
      return `${d.name ?? ''}`.trim()
    case 'fire.cancel_booking':
      return `ยกเลิกจุดไฟ ${d.name ?? ''}${d.officer_name ? ` ของ ${d.officer_name}` : ''}`.trim()
    case 'region_change.request':
      return `${arrowFrom(d.previous_province_path)}${prov(d.province_path)}`
    case 'region_change.approved':
    case 'region_change.rejected': {
      const who = d.officer_name ? `${d.officer_name}: ` : ''
      return `${who}${arrowFrom(d.previous_province_path)}${prov(d.province_path)}`
    }
    case 'settings.location_poll':
      return d.minutes != null ? `ทุก ${d.minutes} นาที` : ''
    case 'auth.revoke_user':
    case 'auth.restore_user':
      return d.name ?? ''
    case 'officer.verify':
    case 'officer.delete':
      return entity('เจ้าหน้าที่', d.province_path)
    case 'dispatcher.create':
    case 'dispatcher.delete':
      return entity('ผู้ดูแล', d.region_path)
    case 'dispatcher.update': {
      const parts = renameParts()
      if (d.region_path) parts.push(`ย้ายพื้นที่: ${prov(d.region_path)}`)
      if (d.password_changed) parts.push('รีเซ็ตรหัสผ่าน')
      return parts.join('\n')
    }
    case 'officer.update': {
      const parts = renameParts()
      if (d.province_path) parts.push(`ย้ายไป: ${arrowFrom(d.previous_province_path)}${prov(d.province_path)}`)
      if (d.password_changed) parts.push(`รีเซ็ตรหัสผ่าน${d.officer_name ? `: ${d.officer_name}` : ''}`)
      return parts.join('\n')
    }
    default:
      return ''
  }
}

export default function AuditPage() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [error, setError] = useState(null)
  const [action, setAction] = useState('')
  const [onDate, setOnDate] = useState('')
  const [actorInput, setActorInput] = useState('')
  const [actor, setActor] = useState('')
  const [reload, setReload] = useState(0)
  const { regions } = useRegions()
  const provinceNames = useMemo(
    () => Object.fromEntries((regions ?? []).map((p) => [p.path, p.name_th])),
    [regions],
  )

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
        const res = await apiFetch(`/audit?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
        setError(null)
      } catch (e) {
        console.warn('[AuditPage] load failed:', e)
        if (cancelled) return
        setItems([])
        setError('โหลดประวัติไม่สำเร็จ')
      }
    })()
    return () => { cancelled = true }
  }, [page, action, actor, onDate, reload])

  if (!user?.is_superuser) return <Navigate to="/" replace />

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">
      <div className='flex flex-row gap-4 items-center'>
        <h1 className='mt-2 pl-2 font-bold text-3xl text-primary'>บันทึกเหตุการณ์</h1>
        <p className='font-medium text-md text-accent'>รายการเหตุการณ์ต่างที่เกิดขึ้นในระบบ</p>
      </div>

      <div className="flex flex-col flex-1 min-h-0 w-full bg-foreground rounded-2xl p-4 shadow-md">

        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-300">

          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(0) }}
            className={`${SELECT_CLS} max-w-fit`}
          >
            <option value="">ทุกเหตุการณ์</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <input
            type="date"
            value={onDate}
            onChange={(e) => { setOnDate(e.target.value); setPage(0) }}
            className={`${INPUT_CLS} max-w-fit text-accent`}
          />

          <form
            onSubmit={(e) => { e.preventDefault(); setActor(actorInput.trim()); setPage(0) }}
            className="ml-auto flex flex-row w-78 items-center gap-2"
          >
            <input
              type="text"
              value={actorInput}
              title="ค้นหาด้วยชื่อผู้ใช้หรือผู้กระทำ"
              onChange={(e) => setActorInput(e.target.value)}
              onBlur={() => { setActor(actorInput.trim()); setPage(0) }}
              placeholder="ค้นหาด้วยชื่อผู้ใช้หรือผู้กระทำ…"
              autoComplete="off"
              className={`${INPUT_CLS} flex-1 min-w-0 text-accent`}
            />
          </form>

          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="text-md font-semibold text-blue-400 hover:text-blue-700 px-2 py-1.5"
          >
            รีเฟรช
          </button>
        </div>

        <div className={`flex ${(items === null) || error || (items !== null && !error && items.length === 0) ? 'justify-center items-center flex-1' : 'flex-col flex-1 min-h-0'}`}>
          {items === null && <p className="text-gray-400">กำลังโหลด…</p>}
          {error && <p className="text-destructive">{error}</p>}
          {items !== null && !error && items.length === 0 && (
            <p className="text-gray-400">ไม่พบประวัติ</p>
          )}

          {items !== null && !error && items.length > 0 && (
            <div className="flex-1 min-h-0 overflow-auto minimal-scrollbar">
              <table className="w-full table-fixed text-left border-collapse">
                <colgroup>
                  <col className="w-36" />
                  <col className="w-40" />
                  <col />
                  <col className="w-32" />
                </colgroup>
                <thead className={THEAD_CLS}>
                  <tr className="text-accent text-sm">
                    <th className="px-3 py-2 font-medium">เหตุการณ์</th>
                    <th className="px-3 py-2 font-medium">ผู้กระทำ</th>
                    <th className="px-3 py-2 font-medium">รายละเอียด</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-background hover:bg-background/50">
                      <td className="px-3 py-2.5 align-top">
                        <span title={ACTION_LABELS[item.action] ?? item.action} className={`block w-32 text-center text-xs font-semibold px-2 py-1.5 rounded-full truncate ${ACTION_COLORS[item.action.split('.')[0]] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ACTION_LABELS[item.action] ?? item.action}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 font-light break-all">
                        {item.actor_username === 'system' ? 'ระบบ' : item.actor_username}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 font-light whitespace-pre-line wrap-break-word">
                        {summarize(item, provinceNames) || '—'}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 whitespace-nowrap text-right">
                        {formatEventTime(item.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {items?.length > 0 && (
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
