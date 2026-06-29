import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FireIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { useFireData } from '../lib/useFireData'
import { useMapSelection, useSocketStore } from '../lib/stateStore'
import { useAuthStore, can } from '../lib/useAuthStore'

const collator = new Intl.Collator('th')
const DAY_MS = 24 * 60 * 60 * 1000
// Asia/Bangkok is a fixed UTC+7 (no DST, ever). Ingested detections carry Thai
// wall-clock numbers tagged +00:00 (see backend db_control/fires.py), so elapsed
// time vs a real clock comes up ~7h short and must be added back.
// ponytail: hardcoded +7h; only wrong if Thailand ever adopts DST.
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000
// mirrors backend FIRE_EXPIRE_DAYS — open fires auto-expire after this many days
const EXPIRE_DAYS = 10

function asDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

// real elapsed ms since a Thai-wall-clock detection timestamp
function detectedAgeMs(value, nowMs) {
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : nowMs - t + THAI_OFFSET_MS
}

// Thai calendar date (YYYY-MM-DD) of a detected_at (already Thai wall-clock)
function detectedDayKey(value) {
  const d = asDate(value)
  return d ? d.toISOString().slice(0, 10) : null
}

// Thai calendar date of a real-UTC instant (resolve_time, now)
function utcDayKey(ms) {
  return new Date(ms + THAI_OFFSET_MS).toISOString().slice(0, 10)
}

function formatDateTime(value) {
  const date = asDate(value)
  if (!date) return '-'
  // timeZone UTC so the stored Thai wall-clock numbers display literally
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

function formatAge(value, nowMs) {
  const ageMs = detectedAgeMs(value, nowMs)
  if (ageMs === null) return '-'
  const minutes = Math.max(0, Math.round(ageMs / 60000))
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
    timeZone: 'UTC',
  }).format(value)
}

function formatShortDay(value) {
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(value)
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
    forest: 'border-flame bg-flame-light text-brand',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    slate: 'border-gray-200 bg-background text-accent',
  }

  return (
    <div className="rounded-2xl bg-foreground p-4 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-1 truncate text-2xl font-semibold leading-none text-accent">{value}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 truncate text-sm text-gray-500">{detail}</p>
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-foreground shadow-md p-2">
      <div className="flex items-center justify-between gap-3 border-b border-gray-300 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-accent">{title}</h2>
          <p className="truncate text-sm text-gray-500">{subtitle}</p>
        </div>
        {Icon && <Icon className="h-5 w-5 shrink-0 text-gray-400" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto minimal-scrollbar">{children}</div>
    </section>
  )
}

function StatusBadge({ children, tone = 'slate' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-gray-50 text-gray-600 border-gray-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

function ProgressBar({ value, total, tone = 'bg-primary' }) {
  return (
    <div className="h-2 w-full rounded-full bg-background">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${clampPercent(value, total)}%` }} />
    </div>
  )
}

function VelocityColumnChart({ rows, maxValue }) {
  const safeMax = Math.max(maxValue, 1)

  if (!rows.length) {
    return <EmptyState>ยังไม่มีข้อมูลในช่วงที่แสดง</EmptyState>
  }

  return (
    <div className="flex h-full min-h-[260px] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2 text-sm text-gray-500">
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-blue-400" />พบไฟ</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-full bg-primary" />ปิดงาน</span>
        </div>
        <span className="truncate">สูงสุด {safeMax} จุด/วัน · ปิดงานตามวันที่ปิดจริง</span>
      </div>
      <div
        className="grid min-h-0 flex-1 items-end gap-1.5 px-3 py-3"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((row) => {
          const detected = Math.max(0, row.detected)
          const resolved = Math.max(0, row.resolved)

          return (
            <div key={row.key} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
              <div className="text-center leading-tight">
                <p className="text-sm font-semibold text-blue-700">{detected}</p>
                <p className="text-sm font-medium text-primary">{resolved} ปิด</p>
              </div>
              <div className="flex h-36 w-full items-end justify-center gap-1">
                <div
                  className="w-2.5 rounded-t bg-blue-400"
                  style={{ height: `${clampPercent(detected, safeMax)}%` }}
                  title={`พบ ${detected} จุด`}
                />
                <div
                  className="w-2.5 rounded-t bg-primary"
                  style={{ height: `${clampPercent(resolved, safeMax)}%` }}
                  title={`ปิด ${resolved} จุด`}
                />
              </div>
              <p className="truncate text-center text-sm font-medium text-gray-500">{row.label}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyState({ children }) {
  return <p className="px-3 py-5 text-sm text-gray-400">{children}</p>
}

function CompactRows({ rows, renderRow }) {
  if (!rows.length) return <EmptyState>ยังไม่มีข้อมูลในช่วงที่แสดง</EmptyState>
  return <div className="divide-y divide-background">{rows.map(renderRow)}</div>
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const fires = useFireData()
  const ready = useSocketStore((s) => s.ready)
  const send = useSocketStore((s) => s.send)
  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const canViewOfficers = can(useAuthStore((s) => s.user), 'officers.view')
  const setFocusedFire = useMapSelection((s) => s.setFocused)

  const [activeTab, setActiveTab] = useState('ops')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const officers = useMemo(() => officersMsg?.officers ?? [], [officersMsg])
  const pendingOfficers = useMemo(() => pendingMsg?.officers ?? [], [pendingMsg])

  useEffect(() => {
    if (!ready || !canViewOfficers) return
    send({ type: 'list_officers' })
    send({ type: 'list_pending_officers' })
  }, [ready, send, canViewOfficers])

  const refresh = useCallback(() => {
    setNowMs(Date.now())
    if (ready) {
      if (canViewOfficers) {
        send({ type: 'list_officers' })
        send({ type: 'list_pending_officers' })
      }
      send({ type: 'resync_fires' })
    }
  }, [ready, send, canViewOfficers])

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
    // span the full window of loaded fires (matches the metric cards) instead of a
    // fixed 7 days, so the chart and the headline numbers share one reference frame
    const todayKey = utcDayKey(nowMs)
    let minKey = todayKey
    for (const fire of fires) {
      const key = detectedDayKey(fire.detected_at)
      if (key && key < minKey) minKey = key
    }
    const endMs = Date.parse(`${todayKey}T00:00:00Z`)
    const startMs = Date.parse(`${minKey}T00:00:00Z`)
    const span = Math.min(14, Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1))
    const rows = Array.from({ length: span }, (_, index) => {
      const dayMs = endMs - (span - 1 - index) * DAY_MS
      const key = new Date(dayMs).toISOString().slice(0, 10)
      return { key, label: formatShortDay(new Date(dayMs)), detected: 0, resolved: 0, falseAlarm: 0, expired: 0 }
    })
    const byKey = new Map(rows.map((row) => [row.key, row]))
    for (const fire of fires) {
      const detectedRow = byKey.get(detectedDayKey(fire.detected_at))
      if (detectedRow) detectedRow.detected += 1
      // closes count toward the day the fire was actually closed (resolve_time),
      // not its detection day — that's true daily throughput, not a cohort
      if (fire.status && fire.resolve_time) {
        const closeRow = byKey.get(utcDayKey(Date.parse(fire.resolve_time)))
        if (closeRow) {
          if (fire.false_alarm) closeRow.falseAlarm += 1
          else if (fire.expired) closeRow.expired += 1
          else closeRow.resolved += 1
        }
      }
    }
    return rows
  }, [fires, nowMs])

  // backlog: open, unassigned, and already older than 3 days — the real workload
  // pressure, unlike "coverage" which is structurally near-zero on a small fleet
  const backlog = useMemo(
    () => summary.unassigned.filter((f) => (detectedAgeMs(f.detected_at, nowMs) ?? 0) > 3 * DAY_MS).length,
    [summary.unassigned, nowMs],
  )

  // closure rate over a mature cohort (fires old enough to have been acted on) —
  // a window-wide rate is dragged to ~0 by fires detected today that can't be closed yet
  const cohort = useMemo(() => {
    const matured = fires.filter((f) => (detectedAgeMs(f.detected_at, nowMs) ?? 0) > 2 * DAY_MS)
    const handled = matured.filter((f) => f.status && !f.expired)
    return { total: matured.length, handled: handled.length }
  }, [fires, nowMs])

  const todayLabel = useMemo(() => formatDateOnly(new Date(nowMs + THAI_OFFSET_MS)), [nowMs])
  const todayOutcomes = dailyRows[dailyRows.length - 1] ?? { detected: 0, resolved: 0, falseAlarm: 0, expired: 0 }
  const openCoverage = summary.open.length ? percent(summary.assigned.length, summary.open.length) : 100
  const cohortClosureRate = cohort.total ? percent(cohort.handled, cohort.total) : 0
  // false-alarm rate among officer-attended closes (resolved + false alarm)
  const attendedCloses = summary.resolved.length + summary.falseAlarm.length
  const falseAlarmRate = attendedCloses ? percent(summary.falseAlarm.length, attendedCloses) : 0
  const topProvince = topProvinceRows[0]
  const maxDailyValue = Math.max(...dailyRows.map((row) => Math.max(row.detected, row.resolved)), 1)

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 flex-row items-center gap-4">
            <h1 className="truncate pl-2 font-bold text-3xl text-primary">สรุปสถานการณ์ไฟป่า</h1>
            <p className="hidden font-medium text-md text-accent lg:block">ภาพรวมการปฏิบัติงานและสถิติไฟป่า</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 justify-self-end">
            <div className="flex rounded-lg bg-foreground p-1 shadow-md">
              {[
                { key: 'ops', label: 'ปฏิบัติการ' },
                { key: 'info', label: 'ข้อมูลสรุป' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${activeTab === tab.key
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-accent hover:bg-background'
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-foreground text-accent shadow-md hover:bg-background"
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
                title="งานค้างเกิน 3 วัน"
                value={backlog}
                detail={`ความครอบคลุม ${openCoverage}% · ${summary.assigned.length}/${summary.open.length} จุดมีผู้รับผิดชอบ`}
                tone={backlog ? 'red' : 'blue'}
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
                        <p className="truncate text-sm font-semibold text-accent">{row.province}</p>
                        <div className="flex shrink-0 gap-1.5">
                          <StatusBadge tone={row.open ? 'red' : 'green'}>{row.open} เปิด</StatusBadge>
                          <StatusBadge tone="blue">{row.assigned} ครอบคลุม</StatusBadge>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.assigned} total={Math.max(row.open, 1)} tone="bg-blue-500" />
                        <span className="w-10 text-right text-sm text-gray-500">{percent(row.assigned, row.open)}%</span>
                      </div>
                    </div>
                  )}
                />
              </Panel>

              <Panel title="รอมอบหมาย" subtitle="เรียงจากจุดที่รอนานที่สุด · เตือนใกล้หมดอายุ" icon={FireIcon}>
                <CompactRows
                  rows={watchlist}
                  renderRow={(fire) => {
                    const daysLeft = EXPIRE_DAYS - (detectedAgeMs(fire.detected_at, nowMs) ?? 0) / DAY_MS
                    const nearExpiry = daysLeft <= 2
                    return (
                      <button
                        key={fire.id}
                        type="button"
                        onClick={() => openFireOnMap(fire.id)}
                        className="block w-full px-3 py-3 text-left transition hover:bg-background/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-accent">{fire.name}</p>
                            <p className="truncate text-sm text-gray-500">{[fire.tumboon, fire.aumper, fire.province].filter(Boolean).join(' / ')}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge tone="amber">{formatAge(fire.detected_at, nowMs)}</StatusBadge>
                            {nearExpiry && (
                              <StatusBadge tone="red">หมดอายุใน {Math.max(0, Math.ceil(daysLeft))} วัน</StatusBadge>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-sm font-medium text-brand">เปิดในแผนที่เพื่อมอบหมายเจ้าหน้าที่</p>
                      </button>
                    )
                  }}
                />
              </Panel>

              <Panel title="ทรัพยากร" subtitle="ความพร้อมเจ้าหน้าที่และสถานะวันนี้" icon={UserGroupIcon}>
                <div className="space-y-3 p-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-accent">เจ้าหน้าที่ออนไลน์</span>
                      <span className="text-gray-500">{officerSummary.online.length}/{officers.length}</span>
                    </div>
                    <ProgressBar value={officerSummary.online.length} total={officers.length} tone="bg-primary" />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-accent">พร้อมปฏิบัติงาน</span>
                      <span className="text-gray-500">{officerSummary.available.length}/{officerSummary.online.length}</span>
                    </div>
                    <ProgressBar value={officerSummary.available.length} total={officerSummary.online.length} tone="bg-blue-500" />
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <p className="mb-2 text-sm font-semibold text-accent">บัญชีเจ้าหน้าที่</p>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center">
                      <p className="text-xl font-semibold text-amber-900">{pendingOfficers.length}</p>
                      <p className="text-sm text-amber-700">รอยืนยันบัญชี</p>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <p className="mb-2 text-sm font-semibold text-accent">สรุปกิจกรรมวันนี้ {todayLabel}</p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
                        <p className="text-xl font-semibold text-blue-900">{todayOutcomes.detected}</p>
                        <p className="text-sm text-blue-700">พบวันนี้</p>
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                        <p className="text-xl font-semibold text-emerald-900">{todayOutcomes.resolved}</p>
                        <p className="text-sm text-emerald-700">ปิดงานวันนี้</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-2">
                        <p className="text-xl font-semibold text-accent">{todayOutcomes.falseAlarm}</p>
                        <p className="text-sm text-gray-500">ปิด: ไม่พบไฟ</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-2">
                        <p className="text-xl font-semibold text-accent">{todayOutcomes.expired}</p>
                        <p className="text-sm text-gray-500">หมดอายุ</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-background p-2 text-sm text-gray-600">
                    จุดล่าสุด: <span className="font-semibold text-accent">{summary.newest ? formatDateTime(summary.newest.detected_at) : '-'}</span>
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
                title="อัตราปิดงาน (อายุเกิน 2 วัน)"
                value={`${cohortClosureRate}%`}
                detail={`${cohort.handled}/${cohort.total} จุดที่โตพอจะปิดได้`}
                tone="forest"
              />
              <MetricCard
                icon={ExclamationTriangleIcon}
                title="อัตราไม่พบไฟ"
                value={`${falseAlarmRate}%`}
                detail={`${summary.falseAlarm.length}/${attendedCloses} การออกตรวจไม่พบไฟ`}
                tone="amber"
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
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-sm font-semibold text-gray-600">{index + 1}</span>
                          <p className="truncate text-sm font-semibold text-accent">{row.province}</p>
                        </div>
                        <StatusBadge tone="green">{row.resolved} ปิด</StatusBadge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.resolved} total={row.total} tone="bg-emerald-500" />
                        <span className="w-16 text-right text-sm text-gray-500">{row.resolved}/{row.total} จุด</span>
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
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-sm font-semibold text-gray-600">{index + 1}</span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-accent">{row.district}</p>
                            <p className="truncate text-sm text-gray-500">{row.province}</p>
                          </div>
                        </div>
                        <StatusBadge tone="green">{row.resolved} ปิด</StatusBadge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={row.resolved} total={row.total} tone="bg-blue-500" />
                        <span className="w-16 text-right text-sm text-gray-500">{row.resolved}/{row.total} จุด</span>
                      </div>
                    </div>
                  )}
                />
              </Panel>

              <Panel title="Velocity รายวัน" subtitle="เทียบจำนวนพบไฟ (วันที่พบ) กับงานปิด (วันที่ปิดจริง)" icon={ClockIcon}>
                <VelocityColumnChart rows={dailyRows} maxValue={maxDailyValue} />
              </Panel>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
