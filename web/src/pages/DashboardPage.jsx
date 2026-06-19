import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  FireIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { useFireData } from '../functions/useFireData'
import { useMapSelection, useSocketStore } from '../functions/stateStore'

const collator = new Intl.Collator('th')
const DAY_MS = 24 * 60 * 60 * 1000

function asDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function formatDateTime(value) {
  const date = asDate(value)
  if (!date) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatAge(value, nowMs) {
  const date = asDate(value)
  if (!date) return '-'
  const minutes = Math.max(0, Math.round((nowMs - date.getTime()) / 60000))
  if (minutes < 60) return `${minutes} นาที`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชม. ${minutes % 60} นาที`
  return `${Math.floor(hours / 24)} วัน ${hours % 24} ชม.`
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value)
}

function formatShortDay(value) {
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short' }).format(value)
}

function percent(value, total) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

function clampPercent(value, total) {
  return Math.max(0, Math.min(100, percent(value, total)))
}

function groupRows(items, keyFn, factory, update) {
  const grouped = new Map()
  for (const item of items) {
    const key = keyFn(item) || 'ไม่ระบุ'
    const row = grouped.get(key) ?? factory(key, item)
    update(row, item)
    grouped.set(key, row)
  }
  return [...grouped.values()]
}

function MetricCard({ icon: Icon, title, value, detail, tone = 'forest' }) {
  const tones = {
    forest: 'border-forest-200 bg-forest-50 text-forest-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    slate: 'border-slate-200 bg-white text-slate-700',
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-1 truncate text-2xl font-semibold leading-none text-slate-900">{value}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 truncate text-xs text-slate-500">{detail}</p>
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        </div>
        {Icon && <Icon className="h-5 w-5 shrink-0 text-slate-400" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

function StatusBadge({ children, tone = 'slate' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

function ProgressBar({ value, total, tone = 'bg-forest-500' }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${clampPercent(value, total)}%` }} />
    </div>
  )
}

function VelocityColumnChart({ rows, maxTotal }) {
  const safeMax = Math.max(maxTotal, 1)

  if (!rows.length) {
    return <EmptyState>ยังไม่มีข้อมูลในช่วงที่แสดง</EmptyState>
  }

  return (
    <div className="flex h-full min-h-[260px] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-blue-100" />พบไฟ</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-forest-500" />ปิดแล้ว</span>
        </div>
        <span className="truncate">เทียบกับวันที่พบไฟมากสุด {safeMax} จุด</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 items-end gap-2 px-3 py-3">
        {rows.map((row) => {
          const safeTotal = Math.max(0, row.total)
          const safeResolved = Math.min(Math.max(0, row.resolved), safeTotal)

          return (
            <div key={row.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
              <div className="text-center leading-tight">
                <p className="text-xs font-semibold text-slate-700">{safeTotal}</p>
                <p className="text-[11px] text-slate-500">{safeResolved} ปิด</p>
              </div>
              <div className="relative h-36 w-full max-w-10 overflow-hidden rounded-t-md bg-slate-100">
                <div
                  className="absolute bottom-0 left-0 w-full rounded-t-md bg-blue-100"
                  style={{ height: `${clampPercent(safeTotal, safeMax)}%` }}
                />
                <div
                  className="absolute bottom-0 left-0 w-full rounded-t-md bg-forest-500"
                  style={{ height: `${clampPercent(safeResolved, safeMax)}%` }}
                />
              </div>
              <p className="truncate text-center text-[11px] font-medium text-slate-500">{row.label}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyState({ children }) {
  return <p className="px-3 py-5 text-sm text-slate-500">{children}</p>
}

function CompactRows({ rows, renderRow }) {
  if (!rows.length) return <EmptyState>ยังไม่มีข้อมูลในช่วงที่แสดง</EmptyState>
  return <div className="divide-y divide-slate-100">{rows.map(renderRow)}</div>
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const fires = useFireData()
  const ready = useSocketStore((s) => s.ready)
  const send = useSocketStore((s) => s.send)
  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const setFocusedFire = useMapSelection((s) => s.setFocused)

  const [activeTab, setActiveTab] = useState('ops')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const officers = useMemo(() => officersMsg?.officers ?? [], [officersMsg])
  const pendingOfficers = useMemo(() => pendingMsg?.officers ?? [], [pendingMsg])

  useEffect(() => {
    if (!ready) return
    send({ type: 'list_officers' })
    send({ type: 'list_pending_officers' })
  }, [ready, send])

  const refresh = useCallback(() => {
    setNowMs(Date.now())
    if (ready) {
      send({ type: 'list_officers' })
      send({ type: 'list_pending_officers' })
      send({ type: 'resync_fires' })
    }
  }, [ready, send])

  const openFireOnMap = useCallback(
    (fireId) => {
      setFocusedFire(fireId)
      navigate('/map')
    },
    [navigate, setFocusedFire],
  )

  const summary = useMemo(() => {
    const open = fires.filter((f) => !f.status)
    const assigned = open.filter((f) => f.booked)
    const unassigned = open.filter((f) => !f.booked)
    const resolved = fires.filter((f) => f.status && !f.expired && !f.false_alarm)
    const expired = fires.filter((f) => f.expired)
    const falseAlarm = fires.filter((f) => f.false_alarm)
    const newest = [...fires].sort((a, b) => (asDate(b.detected_at)?.getTime() ?? 0) - (asDate(a.detected_at)?.getTime() ?? 0))[0]

    return { open, assigned, unassigned, resolved, expired, falseAlarm, newest }
  }, [fires])

  const officerSummary = useMemo(() => {
    const online = officers.filter((o) => o.active)
    const busy = officers.filter((o) => o.fire_id)
    const available = officers.filter((o) => o.active && !o.fire_id)
    return { online, busy, available }
  }, [officers])

  const provinceRows = useMemo(() => {
    return groupRows(
      fires,
      (f) => f.province,
      (province) => ({ province, total: 0, open: 0, assigned: 0, resolved: 0 }),
      (row, f) => {
        row.total += 1
        if (!f.status) row.open += 1
        if (!f.status && f.booked) row.assigned += 1
        if (f.status && !f.false_alarm && !f.expired) row.resolved += 1
      },
    )
      .sort((a, b) => b.open - a.open || b.total - a.total || collator.compare(a.province, b.province))
  }, [fires])

  const topProvinceRows = useMemo(() => {
    return groupRows(
      fires,
      (f) => f.province,
      (province) => ({ province, total: 0, resolved: 0 }),
      (row, f) => {
        row.total += 1
        if (f.status && !f.false_alarm && !f.expired) row.resolved += 1
      },
    )
      .sort((a, b) => b.resolved - a.resolved || b.total - a.total || collator.compare(a.province, b.province))
      .slice(0, 3)
  }, [fires])

  const topDistrictRows = useMemo(() => {
    return groupRows(
      fires,
      (f) => `${f.aumper || 'ไม่ระบุอำเภอ'}|${f.province || 'ไม่ระบุจังหวัด'}`,
      (_key, f) => ({
        district: f.aumper || 'ไม่ระบุอำเภอ',
        province: f.province || 'ไม่ระบุจังหวัด',
        total: 0,
        resolved: 0,
      }),
      (row, f) => {
        row.total += 1
        if (f.status && !f.false_alarm && !f.expired) row.resolved += 1
      },
    )
      .sort((a, b) => b.resolved - a.resolved || b.total - a.total || collator.compare(a.district, b.district))
      .slice(0, 3)
  }, [fires])

  const watchlist = useMemo(() => {
    return [...summary.unassigned]
      .sort((a, b) => (asDate(a.detected_at)?.getTime() ?? 0) - (asDate(b.detected_at)?.getTime() ?? 0))
  }, [summary.unassigned])

  const dailyRows = useMemo(() => {
    const today = new Date(nowMs)
    today.setHours(0, 0, 0, 0)
    const rows = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getTime() - (6 - index) * DAY_MS)
      return {
        key: date.toISOString().slice(0, 10),
        label: formatShortDay(date),
        total: 0,
        resolved: 0,
        falseAlarm: 0,
        expired: 0,
      }
    })
    const byKey = new Map(rows.map((row) => [row.key, row]))
    for (const fire of fires) {
      const detected = asDate(fire.detected_at)
      if (!detected) continue
      const key = detected.toISOString().slice(0, 10)
      const row = byKey.get(key)
      if (!row) continue
      row.total += 1
      if (fire.status && !fire.false_alarm && !fire.expired) row.resolved += 1
      if (fire.false_alarm) row.falseAlarm += 1
      if (fire.expired) row.expired += 1
    }
    return rows
  }, [fires, nowMs])

  const todayLabel = useMemo(() => formatDateOnly(new Date(nowMs)), [nowMs])
  const todayOutcomes = dailyRows[dailyRows.length - 1] ?? { total: 0, resolved: 0, falseAlarm: 0, expired: 0 }
  const openCoverage = summary.open.length ? percent(summary.assigned.length, summary.open.length) : 100
  const resolutionRate = fires.length ? percent(summary.resolved.length, fires.length) : 0
  const topProvince = topProvinceRows[0]
  const recentTotals = dailyRows.reduce(
    (totals, row) => ({
      total: totals.total + row.total,
      resolved: totals.resolved + row.resolved,
    }),
    { total: 0, resolved: 0 },
  )
  const maxDailyTotal = Math.max(...dailyRows.map((row) => row.total), 1)

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-slate-50">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-normal text-slate-950">สรุปสถานการณ์ไฟป่า</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 justify-self-end">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {[
                { key: 'ops', label: 'ปฏิบัติการ' },
                { key: 'info', label: 'ข้อมูลสรุป' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                    activeTab === tab.key
                      ? 'bg-forest-500 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refresh}
              title="รีเฟรชข้อมูล"
              aria-label="รีเฟรชข้อมูล"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-100"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {activeTab === 'ops' ? (
          <>
            <section className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={FireIcon}
                title="ไฟที่ยังเปิด"
                value={summary.open.length}
                detail={`${summary.unassigned.length} จุดยังไม่มีเจ้าหน้าที่`}
                tone={summary.unassigned.length ? 'red' : 'forest'}
              />
              <MetricCard
                icon={ShieldCheckIcon}
                title="ความครอบคลุม"
                value={`${openCoverage}%`}
                detail={`${summary.assigned.length}/${summary.open.length} จุดเปิดมีผู้รับผิดชอบ`}
                tone="blue"
              />
              <MetricCard
                icon={UserGroupIcon}
                title="เจ้าหน้าที่ว่าง"
                value={`${officerSummary.available.length} ว่าง`}
                detail={`จาก ${officerSummary.online.length} คนออนไลน์`}
                tone={officerSummary.available.length ? 'forest' : 'amber'}
              />
              <MetricCard
                icon={ClockIcon}
                title="จุดล่าสุด"
                value={summary.newest ? formatAge(summary.newest.detected_at, nowMs) : '-'}
                detail={summary.newest ? summary.newest.province ?? 'จุดที่ตรวจพบล่าสุด' : 'ยังไม่มีจุดไฟในหน้าปัจจุบัน'}
                tone="slate"
              />
            </section>

            <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[1.05fr_0.95fr_0.95fr]">
              <Panel title="จังหวัดที่ต้องติดตาม" subtitle="ไฟที่ยังเปิดและความครอบคลุมปัจจุบัน" icon={MapPinIcon}>
                <CompactRows
                  rows={provinceRows}
                  renderRow={(row) => (
                    <div key={row.province} className="px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-slate-800">{row.province}</p>
                        <div className="flex shrink-0 gap-1.5">
                          <StatusBadge tone={row.open ? 'red' : 'green'}>{row.open} เปิด</StatusBadge>
                          <StatusBadge tone="blue">{row.assigned} ครอบคลุม</StatusBadge>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.assigned} total={Math.max(row.open, 1)} tone="bg-blue-500" />
                        <span className="w-10 text-right text-xs text-slate-500">{percent(row.assigned, row.open)}%</span>
                      </div>
                    </div>
                  )}
                />
              </Panel>

              <Panel title="รอมอบหมาย" subtitle="เรียงจากจุดที่รอนานที่สุด" icon={FireIcon}>
                <CompactRows
                  rows={watchlist}
                  renderRow={(fire) => (
                    <button
                      key={fire.id}
                      type="button"
                      onClick={() => openFireOnMap(fire.id)}
                      className="block w-full px-3 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-forest-500"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{fire.name}</p>
                          <p className="truncate text-xs text-slate-500">{[fire.tumboon, fire.aumper, fire.province].filter(Boolean).join(' / ')}</p>
                        </div>
                        <StatusBadge tone="amber">{formatAge(fire.detected_at, nowMs)}</StatusBadge>
                      </div>
                      <p className="mt-1 text-xs font-medium text-forest-700">เปิดในแผนที่เพื่อมอบหมายเจ้าหน้าที่</p>
                    </button>
                  )}
                />
              </Panel>

              <Panel title="ทรัพยากร" subtitle="ความพร้อมเจ้าหน้าที่และสถานะวันนี้" icon={UserGroupIcon}>
                <div className="space-y-3 p-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">เจ้าหน้าที่ออนไลน์</span>
                      <span className="text-slate-500">{officerSummary.online.length}/{officers.length}</span>
                    </div>
                    <ProgressBar value={officerSummary.online.length} total={officers.length} tone="bg-forest-500" />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">พร้อมปฏิบัติงาน</span>
                      <span className="text-slate-500">{officerSummary.available.length}/{officerSummary.online.length}</span>
                    </div>
                    <ProgressBar value={officerSummary.available.length} total={officerSummary.online.length} tone="bg-blue-500" />
                  </div>
                  <div className="border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">บัญชีเจ้าหน้าที่</p>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center">
                      <p className="text-xl font-semibold text-amber-900">{pendingOfficers.length}</p>
                      <p className="text-[11px] text-amber-700">รอยืนยันบัญชี</p>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">สถานะจุดไฟที่ตรวจพบ วันที่ {todayLabel}</p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
                        <p className="text-xl font-semibold text-blue-900">{todayOutcomes.total}</p>
                        <p className="text-[11px] text-blue-700">พบวันนี้</p>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                        <p className="text-xl font-semibold text-emerald-900">{todayOutcomes.resolved}</p>
                        <p className="text-[11px] text-emerald-700">ปิดแล้ว</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-xl font-semibold text-slate-900">{todayOutcomes.falseAlarm}</p>
                        <p className="text-[11px] text-slate-500">ไม่พบไฟ</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2">
                        <p className="text-xl font-semibold text-slate-900">{todayOutcomes.expired}</p>
                        <p className="text-[11px] text-slate-500">หมดอายุ</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    จุดล่าสุด: <span className="font-semibold text-slate-800">{summary.newest ? formatDateTime(summary.newest.detected_at) : '-'}</span>
                  </div>
                </div>
              </Panel>
            </section>
          </>
        ) : (
          <>
            <section className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={MapPinIcon}
                title="จุดไฟที่แสดง"
                value={fires.length}
                detail={`${summary.resolved.length} จุดปิดแล้วในชุดข้อมูลนี้`}
                tone="blue"
              />
              <MetricCard
                icon={CheckCircleIcon}
                title="อัตราปิดงาน"
                value={`${resolutionRate}%`}
                detail="นับเฉพาะจุดที่ปิดสำเร็จ"
                tone="forest"
              />
              <MetricCard
                icon={ClockIcon}
                title="ช่วง 7 วัน"
                value={`${recentTotals.total} จุด`}
                detail={`${recentTotals.resolved} จุดในช่วงนี้ปิดแล้ว`}
                tone="slate"
              />
              <MetricCard
                icon={MapPinIcon}
                title="จังหวัดเด่น"
                value={topProvince?.province ?? '-'}
                detail={topProvince ? `${topProvince.resolved}/${topProvince.total} จุดปิดแล้ว` : 'ยังไม่มีข้อมูลจังหวัด'}
                tone="amber"
              />
            </section>

            <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[0.82fr_0.82fr_1.36fr]">
              <Panel title="Top 3 จังหวัด" subtitle="เรียงตามจำนวนงานปิด แถบแสดงสัดส่วนปิดงาน" icon={MapPinIcon}>
                <CompactRows
                  rows={topProvinceRows}
                  renderRow={(row, index) => (
                    <div key={row.province} className="px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
                          <p className="truncate text-sm font-semibold text-slate-800">{row.province}</p>
                        </div>
                        <StatusBadge tone="green">{row.resolved} ปิด</StatusBadge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.resolved} total={row.total} tone="bg-emerald-500" />
                        <span className="w-16 text-right text-xs text-slate-500">{row.resolved}/{row.total} จุด</span>
                      </div>
                    </div>
                  )}
                />
              </Panel>

              <Panel title="Top 3 อำเภอ" subtitle="เรียงตามจำนวนงานปิด แถบแสดงสัดส่วนปิดงาน" icon={MapPinIcon}>
                <CompactRows
                  rows={topDistrictRows}
                  renderRow={(row, index) => (
                    <div key={`${row.district}-${row.province}`} className="px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{row.district}</p>
                            <p className="truncate text-xs text-slate-500">{row.province}</p>
                          </div>
                        </div>
                        <StatusBadge tone="green">{row.resolved} ปิด</StatusBadge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.resolved} total={row.total} tone="bg-blue-500" />
                        <span className="w-16 text-right text-xs text-slate-500">{row.resolved}/{row.total} จุด</span>
                      </div>
                    </div>
                  )}
                />
              </Panel>

              <Panel title="Velocity 7 วัน" subtitle="กราฟแท่งเทียบปริมาณไฟและงานปิดรายวัน" icon={ClockIcon}>
                <VelocityColumnChart rows={dailyRows} maxTotal={maxDailyTotal} />
              </Panel>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
