import { useEffect, useRef, useState } from 'react'

import { API_URL } from './shared'

const PAGE_SIZE = 20

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
  'dispatcher.create': 'สร้างผู้ควบคุม',
  'dispatcher.update': 'แก้ไขผู้ควบคุม',
  'dispatcher.delete': 'ลบผู้ควบคุม',
  'region_change.request': 'ขอย้ายพื้นที่',
  'region_change.approved': 'อนุมัติย้ายพื้นที่',
  'region_change.rejected': 'ปฏิเสธย้ายพื้นที่',
  'region.assign': 'มอบสิทธิ์พื้นที่',
  'region.revoke': 'เพิกถอนสิทธิ์พื้นที่',
  'settings.location_poll': 'ตั้งค่ารอบส่งตำแหน่ง',
  'auth.login': 'เข้าสู่ระบบ',
  'auth.register': 'สมัครบัญชี',
}

const ROLE_LABELS = { field_officer: 'เจ้าหน้าที่', dispatcher: 'ผู้ควบคุม' }

const ACTION_COLORS = {
  fire: 'bg-orange-100 text-orange-700',
  officer: 'bg-blue-100 text-blue-700',
  dispatcher: 'bg-purple-100 text-purple-700',
  region_change: 'bg-teal-100 text-teal-700',
  region: 'bg-emerald-100 text-emerald-700',
  settings: 'bg-amber-100 text-amber-700',
  auth: 'bg-gray-100 text-gray-600',
}

// filter dropdown groups by category prefix instead of every single action
const CATEGORY_LABELS = {
  fire: 'จุดไฟ',
  officer: 'เจ้าหน้าที่',
  dispatcher: 'ผู้ควบคุม',
  region_change: 'คำขอย้ายพื้นที่',
  region: 'สิทธิ์พื้นที่',
  settings: 'การตั้งค่า',
  auth: 'บัญชีผู้ใช้',
}

const AT_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

// resolve a province ltree path to its Thai name, falling back to the raw path
const provName = (names, path) => (path ? (names[path] ?? path) : path)

function summarize(item, names = {}) {
  const d = item.detail ?? {}
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
      return `ยกเลิกไฟ ${d.name ?? ''}`.trim()
    case 'fire.cancel_booking':
      return `ยกเลิกไฟ ${d.name ?? ''}${d.officer_name ? ` ของ ${d.officer_name}` : ''}`.trim()
    case 'region_change.request':
      return provName(names, d.province_path)
    case 'region_change.approved': {
      const who = d.officer_name ? `${d.officer_name}: ` : ''
      const from = d.previous_province_path ? `${provName(names, d.previous_province_path)} → ` : ''
      return `${who}${from}${provName(names, d.province_path)}`
    }
    case 'region_change.rejected':
      return `${d.officer_name ? `${d.officer_name}: ` : ''}${provName(names, d.province_path)}`
    case 'region.assign':
    case 'region.revoke':
      return [provName(names, d.region_path), ROLE_LABELS[d.role] ?? d.role].filter(Boolean).join(' · ')
    case 'settings.location_poll':
      return d.minutes != null ? `ทุก ${d.minutes} นาที` : ''
    case 'officer.verify':
    case 'officer.delete':
    case 'dispatcher.create':
    case 'dispatcher.delete':
      return [d.name, d.username, d.division].filter(Boolean).join(' · ')
    case 'dispatcher.update': {
      const parts = []
      if (d.name) parts.push(`เปลี่ยนชื่อ: ${d.name}`)
      if (d.username) parts.push(`เปลี่ยนชื่อผู้ใช้: ${d.previous_username ? `${d.previous_username} → ` : ''}${d.username}`)
      if ('division' in d) parts.push(`เปลี่ยนสังกัด: ${d.division ?? '—'}`)
      if (d.region_path) parts.push(`ย้ายพื้นที่: ${provName(names, d.region_path)}`)
      if (d.password_changed) parts.push('รีเซ็ตรหัสผ่าน')
      return parts.join('\n')
    }
    case 'officer.update': {
      const parts = []
      if (d.name) parts.push(`เปลี่ยนชื่อ: ${d.name}`)
      if (d.username) parts.push(`เปลี่ยนชื่อผู้ใช้: ${d.previous_username ? `${d.previous_username} → ` : ''}${d.username}`)
      if ('division' in d) parts.push(`เปลี่ยนสังกัด: ${d.division ?? '—'}`)
      if (d.province_path) parts.push(`ย้ายไป: ${d.previous_province_path ? `${provName(names, d.previous_province_path)} → ` : ''}${provName(names, d.province_path)}`)
      if (d.password_changed) parts.push(`รีเซ็ตรหัสผ่าน${d.officer_name ? `: ${d.officer_name}` : ''}`)
      return parts.join('\n')
    }
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
  const [provinceNames, setProvinceNames] = useState({}) // ltree path -> Thai name
  const provincesLoaded = useRef(false)

  // load the province path→name map lazily — only once a visible row actually
  // references a province (officer.update with a province_path), and only once
  useEffect(() => {
    if (provincesLoaded.current) return
    const needsProvince = (items ?? []).some(
      (it) =>
        (it.action === 'officer.update' && it.detail?.province_path) ||
        (it.action === 'dispatcher.update' && it.detail?.region_path) ||
        (it.action.startsWith('region_change.') && it.detail?.province_path) ||
        (it.action.startsWith('region.') && it.detail?.region_path)
    )
    if (!needsProvince) return
    provincesLoaded.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/regions/provinces`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setProvinceNames(Object.fromEntries(data.map((p) => [p.path, p.name_th])))
      } catch (e) {
        console.warn('[AuditTrail] provinces load failed:', e)
        provincesLoaded.current = false // allow a retry on a later render
      }
    })()
    return () => { cancelled = true }
  }, [items])

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
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
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
            placeholder="ค้นหาด้วยชื่อผู้ใช้ผู้กระทำ…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
          />
        </form>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="text-sm text-brand hover:text-brand px-2 py-1.5"
        >
          รีเฟรช
        </button>
      </div>

      {items === null && <p className="text-gray-500">กำลังโหลด…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {items !== null && !error && items.length === 0 && (
        <p className="text-gray-500">ไม่พบประวัติ</p>
      )}

      {items !== null && !error && items.length > 0 && (
        <div className="overflow-y-auto min-h-96 max-h-96 no-scrollbar">
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col className="w-40" />
              <col className="w-48" />
              <col />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="text-xs font-medium text-gray-400 text-left border-b border-gray-200">
                <th className="px-3 py-2 font-medium">เหตุการณ์</th>
                <th className="px-3 py-2 font-medium">ผู้กระทำ</th>
                <th className="px-3 py-2 font-medium">รายละเอียด</th>
                <th className="px-3 py-2 font-medium text-right whitespace-nowrap">เวลา</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2.5 align-top">
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${ACTION_COLORS[item.action.split('.')[0]] ?? 'bg-gray-100 text-gray-600'}`}>
                      {ACTION_LABELS[item.action] ?? item.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top text-gray-600 break-all">
                    {item.actor_username === 'system' ? 'ระบบ' : item.actor_username}
                  </td>
                  <td className="px-3 py-2.5 align-top text-gray-700 whitespace-pre-line wrap-break-word">
                    {summarize(item, provinceNames) || '—'}
                  </td>
                  <td className="px-3 py-2.5 align-top text-xs text-gray-400 whitespace-nowrap text-right">
                    {AT_FORMAT.format(new Date(item.at))} น.
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
  )
}
