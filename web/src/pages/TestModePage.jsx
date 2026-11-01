import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../lib/useAuthStore'
import { useTestMode } from '../lib/useTestMode'
import { apiFetch, PAGE_SIZE, SELECT_CLS, THEAD_CLS } from '../lib/shared'
import { formatDate, formatEventTime } from '../lib/datetime'
import { useRegions } from '../lib/useRegions'
import { toast } from '../lib/toastStore'
import PaginationBar from '../components/PaginationBar'
import RecordCard from '../components/RecordCard'
import DateInput from '../components/DateInput'

// Per-day breakdown of the fires' current outcome; colours match the history page badges.
const OUTCOMES = [
  { key: 'expired', label: 'หมดอายุ', cls: 'bg-amber-100 text-amber-700' },
  { key: 'resolved', label: 'ดับแล้ว', cls: 'bg-green-100 text-green-700' },
  { key: 'false_alarm', label: 'ไม่ใช่ไฟ', cls: 'bg-gray-100 text-gray-600' },
  { key: 'open', label: 'ยังไม่ดับ', cls: 'bg-red-100 text-red-700' },
]

/**
 * OutcomeBadges
 * @param {object} props
 * @param {object} props.day - one /test-mode/days item
 * @returns {JSX.Element} small count pills, only for outcomes present that day
 */
function OutcomeBadges({ day }) {
  return (
    <span className="flex flex-wrap gap-1">
      {OUTCOMES.filter((o) => day[o.key] > 0).map((o) => (
        <span key={o.key} className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${o.cls}`}>
          {o.label} {day[o.key]}
        </span>
      ))}
    </span>
  )
}

/**
 * TestModePage
 * Route-level component (no props). Superuser-only control room for Test mode:
 * switch the system-wide drill on/off, wipe drill data, and replay whole past days
 * of fires (any outcome, including expired) as fresh drill fires. Replaying only
 * reads the real fires; the copies live in the separate test schema on the server.
 *
 * Returns: JSX.Element, or a redirect to '/' for non-superusers.
 */
export default function TestModePage() {
  const user = useAuthStore((s) => s.user)
  const live = useTestMode() // pushed over the socket; authoritative once connected
  const enabled = live.enabled
  const [info, setInfo] = useState(null) // {enabled, since, by, real_bookings} from GET /test-mode
  const [switching, setSwitching] = useState(false)
  const [clearing, setClearing] = useState(false)

  const [items, setItems] = useState(null) // array|null: one row per day; null = loading
  const [total, setTotal] = useState(0) // number of days matching the filters
  const [page, setPage] = useState(0)
  const [province, setProvince] = useState('') // narrows both the counts and the replay
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reload, setReload] = useState(0)
  const [error, setError] = useState(null)
  // Map<'YYYY-MM-DD', fireCount>: chosen days, kept across pages so the button can
  // show the total number of fires a replay will create.
  const [selected, setSelected] = useState(() => new Map())
  const [replaying, setReplaying] = useState(false)
  const { provinces: provinceRegions } = useRegions()
  const provinces = useMemo(() => (provinceRegions ?? []).map((p) => p.name_th), [provinceRegions])

  // Mode details + the "officers on real jobs" count used in the switch-on warning.
  // Re-read whenever the live mode flips so the count is fresh for the next switch.
  useEffect(() => {
    apiFetch('/test-mode')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d))
      .catch(() => {})
  }, [enabled])

  // Fetch one page of days whenever a filter, the page, or `reload` changes.
  useEffect(() => {
    let cancelled = false
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
    if (province) p.set('province', province)
    if (dateFrom) p.set('since', new Date(`${dateFrom}T00:00:00`).toISOString())
    if (dateTo) p.set('until', new Date(new Date(`${dateTo}T00:00:00`).getTime() + 86_400_000).toISOString())
    ;(async () => {
      try {
        const res = await apiFetch(`/test-mode/days?${p}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        setItems(data.items ?? [])
        setTotal(data.total ?? 0)
        setError(null)
      } catch (e) {
        console.warn('[TestModePage] load failed:', e)
        if (cancelled) return
        setItems([])
        setError('โหลดรายการวันไม่สำเร็จ')
      }
    })()
    return () => { cancelled = true }
  }, [page, province, dateFrom, dateTo, reload])

  if (!user?.is_superuser) return <Navigate to="/" replace />

  async function switchMode(next) {
    const msg = next
      ? 'เปิดโหมดทดสอบทั้งระบบ?\nผู้ใช้ทุกคน (รวมแอปเจ้าหน้าที่) จะเห็นเฉพาะจุดไฟทดสอบ'
        + (info?.real_bookings
          ? `\n\nมีเจ้าหน้าที่ ${info.real_bookings} คนกำลังดูแลไฟจริงอยู่ งานเหล่านั้นจะถูกซ่อนจนกว่าจะปิดโหมดทดสอบ`
          : '')
      : 'ปิดโหมดทดสอบ?\nการจองไฟทดสอบทั้งหมดจะถูกยกเลิก ระบบจะกลับมาแสดงจุดไฟจริง\nข้อมูลทดสอบยังถูกเก็บไว้'
    if (!window.confirm(msg)) return
    setSwitching(true)
    try {
      const res = await apiFetch('/test-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(next ? 'เปิดโหมดทดสอบแล้ว' : 'ปิดโหมดทดสอบแล้ว')
    } catch (e) {
      console.warn('[TestModePage] switch failed:', e)
      toast.error('เปลี่ยนโหมดไม่สำเร็จ')
    } finally {
      setSwitching(false)
    }
  }

  async function clearData() {
    if (!window.confirm('ลบข้อมูลทดสอบทั้งหมด?\nจุดไฟทดสอบ ผลการดับ รูปหลักฐาน และบันทึกเหตุการณ์ทดสอบจะถูกลบถาวร การจองไฟทดสอบทั้งหมดจะถูกยกเลิก\nโหมดทดสอบยังเปิดอยู่ (ข้อมูลจริงไม่ได้รับผลกระทบ)')) return
    setClearing(true)
    try {
      const res = await apiFetch('/test-mode/data', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      toast.success(`ลบข้อมูลทดสอบแล้ว (จุดไฟ ${d.fires} · ผลการดับ ${d.resolutions})`)
      setReload((n) => n + 1) // refresh the "replayed" counts
    } catch (e) {
      console.warn('[TestModePage] clear failed:', e)
      toast.error('ลบข้อมูลทดสอบไม่สำเร็จ')
    } finally {
      setClearing(false)
    }
  }

  async function replaySelected() {
    if (selected.size === 0) return
    setReplaying(true)
    try {
      const res = await apiFetch('/test-mode/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: [...selected.keys()], province: province || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { replayed } = await res.json()
      toast.success(`จำลองจุดไฟทดสอบแล้ว ${replayed} จุด จาก ${selected.size} วัน`)
      setSelected(new Map())
      setReload((n) => n + 1) // refresh the "replayed" counts
    } catch (e) {
      console.warn('[TestModePage] replay failed:', e)
      toast.error('จำลองจุดไฟไม่สำเร็จ')
    } finally {
      setReplaying(false)
    }
  }

  const toggle = (d) => setSelected((prev) => {
    const next = new Map(prev)
    if (next.has(d.day)) next.delete(d.day)
    else next.set(d.day, d.total)
    return next
  })
  const pageDays = items ?? []
  const allOnPage = pageDays.length > 0 && pageDays.every((d) => selected.has(d.day))
  const togglePage = () => setSelected((prev) => {
    const next = new Map(prev)
    for (const d of pageDays) {
      if (allOnPage) next.delete(d.day)
      else next.set(d.day, d.total)
    }
    return next
  })
  const selectedFires = [...selected.values()].reduce((a, b) => a + b, 0)
  // Filters change what each day contains, so a selection made under the old filter
  // (and its fire counts) would no longer match what gets replayed.
  const setFilter = (setter) => (e) => { setter(e.target.value); setPage(0); setSelected(new Map()) }

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full lg:max-w-[1600px] flex-col gap-3 px-3 py-3 lg:px-8">
        <div className='flex flex-col md:flex-row md:gap-4 md:items-center pl-12 lg:pl-0'>
          <h1 className='mt-2 pl-2 font-bold text-3xl text-primary'>โหมดทดสอบ</h1>
          <p className='pl-2 md:pl-0 font-medium text-md text-accent'>ซ้อมการทำงานด้วยจุดไฟจากประวัติ แยกจากข้อมูลจริงทั้งหมด</p>
        </div>

        {/* Mode switch + wipe */}
        <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center w-full bg-foreground rounded-2xl p-4 shadow-md">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-3 w-3 rounded-full ${enabled ? 'bg-amber-400' : 'bg-gray-300'}`} />
              <p className="text-lg font-semibold text-accent">{enabled ? 'กำลังเปิดโหมดทดสอบ' : 'ปิดอยู่ (ระบบจริง)'}</p>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {enabled
                ? `เปิดโดย ${live.by ?? '—'}${live.since ? ` เมื่อ ${formatEventTime(live.since)}` : ''} · ผู้ใช้ทุกคนเห็นเฉพาะจุดไฟทดสอบ`
                : 'เมื่อเปิด ผู้ใช้ทุกคนจะเห็นเฉพาะจุดไฟทดสอบ การนำเข้าข้อมูลดาวเทียมจริงยังทำงานตามปกติ'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={clearData}
              disabled={!enabled || clearing}
              title={enabled ? 'ลบจุดไฟ ผลการดับ และบันทึกเหตุการณ์ทดสอบทั้งหมด' : 'ต้องเปิดโหมดทดสอบก่อนจึงจะล้างข้อมูลได้'}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {clearing ? 'กำลังลบ…' : 'ล้างข้อมูลทดสอบ'}
            </button>
            <button
              type="button"
              onClick={() => switchMode(!enabled)}
              disabled={switching}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? 'bg-gray-600 hover:bg-gray-700' : 'bg-amber-500 hover:bg-amber-600'}`}
            >
              {switching ? 'กำลังเปลี่ยน…' : enabled ? 'ปิดโหมดทดสอบ' : 'เปิดโหมดทดสอบ'}
            </button>
          </div>
        </div>

        {/* Day picker: fills the remaining height and scrolls inside, like History/Audit */}
        <div className="flex flex-col flex-1 min-h-0 w-full bg-foreground rounded-2xl p-4 shadow-md">
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center pb-2 border-b border-gray-300">
            <div className="md:mr-2">
              <p className="text-lg font-semibold text-accent">เลือกวันจากประวัติ</p>
              <p className="text-sm text-gray-500">จุดไฟทุกจุดของวันที่เลือกจะถูกจำลองเป็นไฟที่ยังไม่ดับ ข้อมูลจริงไม่ถูกแก้ไข</p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:contents">
              <select value={province} onChange={setFilter(setProvince)} className={`${SELECT_CLS} w-full md:max-w-fit col-span-2`}>
                <option value="">ทุกจังหวัด</option>
                {provinces.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1 w-full md:w-auto">
              <DateInput value={dateFrom} max={dateTo || undefined} onChange={setFilter(setDateFrom)} className="flex-1 md:max-w-fit" />
              <span className="text-accent">–</span>
              <DateInput value={dateTo} min={dateFrom || undefined} onChange={setFilter(setDateTo)} className="flex-1 md:max-w-fit" />
            </div>
            <button
              type="button"
              onClick={replaySelected}
              disabled={!enabled || selected.size === 0 || replaying}
              title={enabled ? undefined : 'ต้องเปิดโหมดทดสอบก่อน'}
              className="md:ml-auto shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {replaying
                ? 'กำลังจำลอง…'
                : selected.size > 0
                  ? `จำลองวันที่เลือก (${selected.size} วัน · ${selectedFires} จุด)`
                  : 'จำลองวันที่เลือก'}
            </button>
          </div>

          {/* Centers the loading/error/empty states; switches to a scrollable column once rows exist */}
          <div className={`flex flex-1 min-h-0 ${!items?.length ?'justify-center items-center min-h-72' : 'flex-col'}`}>
            {items === null && <p className="text-gray-400">กำลังโหลด…</p>}
            {error && <p className="text-destructive">{error}</p>}
            {items !== null && !error && items.length === 0 && <p className="text-gray-400">ไม่พบจุดไฟในช่วงที่เลือก</p>}

            {items !== null && !error && items.length > 0 && (
              <div className="flex-1 min-h-72 overflow-auto minimal-scrollbar">
                <table className="hidden md:table w-full table-fixed text-left border-collapse">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-40" />
                    <col className="w-28" />
                    <col />
                    <col className="w-28" />
                    <col className="w-32" />
                  </colgroup>
                  <thead className={THEAD_CLS}>
                    <tr className="text-accent text-sm">
                      <th className="px-3 py-2">
                        <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="เลือกทุกวันในหน้านี้" className="h-4 w-4" />
                      </th>
                      <th className="px-3 py-2 font-medium">วันที่</th>
                      <th className="px-3 py-2 font-medium text-right">จุดไฟ</th>
                      <th className="px-3 py-2 font-medium">สถานะเดิม</th>
                      <th className="px-3 py-2 font-medium text-right">จังหวัด</th>
                      <th className="px-3 py-2 font-medium text-right">จำลองแล้ว</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => (
                      <tr
                        key={d.day}
                        onClick={() => toggle(d)}
                        className={`cursor-pointer border-b border-background ${selected.has(d.day) ? 'bg-amber-50' : 'hover:bg-background/50'}`}
                      >
                        <td className="px-3 py-2.5 align-top">
                          <input
                            type="checkbox"
                            checked={selected.has(d.day)}
                            onChange={() => toggle(d)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`เลือกวันที่ ${formatDate(d.day)}`}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-2.5 align-top text-sm font-medium text-gray-900">{formatDate(d.day)}</td>
                        <td className="px-3 py-2.5 align-top text-sm font-semibold text-gray-900 text-right">{d.total}</td>
                        <td className="px-3 py-2.5 align-top"><OutcomeBadges day={d} /></td>
                        <td className="px-3 py-2.5 align-top text-sm text-gray-500 text-right">{d.provinces}</td>
                        <td className={`px-3 py-2.5 align-top text-sm text-right ${d.replayed > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>
                          {d.replayed > 0 ? `${d.replayed} จุด` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile: same rows as cards (the table is hidden below md). */}
                <div className="md:hidden space-y-2">
                  {items.map((d) => (
                    <RecordCard
                      key={d.day}
                      titleSlot={
                        <label className="flex items-center gap-2 font-semibold text-primary">
                          <input type="checkbox" checked={selected.has(d.day)} onChange={() => toggle(d)} className="h-5 w-5" />
                          {formatDate(d.day)}
                        </label>
                      }
                      badge={<span className="text-sm font-semibold text-gray-900">{d.total} จุด</span>}
                      rows={[
                        { label: 'สถานะ', value: <OutcomeBadges day={d} /> },
                        { label: 'จังหวัด', value: d.provinces },
                        { label: 'จำลองแล้ว', value: d.replayed > 0 ? `${d.replayed} จุด` : '—' },
                      ]}
                    />
                  ))}
                </div>
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
