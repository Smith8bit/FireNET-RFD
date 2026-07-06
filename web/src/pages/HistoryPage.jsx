import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore, can } from '../lib/useAuthStore'
import { API_URL, apiFetch, INPUT_CLS, PAGE_SIZE, SELECT_CLS, THEAD_CLS } from '../lib/shared'
import { formatEventTime } from '../lib/datetime'
import { useRegions } from '../lib/useRegions'
import PaginationBar from '../components/PaginationBar'

// content-type → download filename extension (mirrors backend IMAGE_EXT/VIDEO_EXT)
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
}

// Resolved-fire history with the officer's evidence (note, photos/video, who, when).
export default function HistoryPage() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState(null) // null = loading
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [kind, setKind] = useState('') // '' = all, 'false' = real fire, 'true' = false alarm
  const [province, setProvince] = useState('') // '' = all provinces (matched by Thai name)
  const { provinces: provinceRegions } = useRegions() // dropdown options, region-scoped to the viewer
  const provinces = useMemo(() => (provinceRegions ?? []).map((p) => p.name_th), [provinceRegions])
  const [dateFrom, setDateFrom] = useState('') // inclusive start day
  const [dateTo, setDateTo] = useState('') // inclusive end day
  const [searchInput, setSearchInput] = useState('') // raw text in the box
  const [search, setSearch] = useState('') // committed query (fire/officer name, location)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [viewer, setViewer] = useState(null) // { path, url, isVideo, filename } | null
  const [savingEvidence, setSavingEvidence] = useState(false)

  // fetch a single evidence file (auth cookie via apiFetch) and save it locally
  async function saveEvidence(path, filename) {
    setSavingEvidence(true)
    try {
      const res = await apiFetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('[HistoryPage] evidence download failed:', e)
    } finally {
      setSavingEvidence(false)
    }
  }

  // Shared filter params (used by both the table query and the ZIP export).
  // since = start of dateFrom; until = start of the day after dateTo (exclusive).
  const buildFilterParams = () => {
    const p = new URLSearchParams()
    if (kind) p.set('false_alarm', kind)
    if (province) p.set('province', province)
    if (search) p.set('search', search)
    if (dateFrom) p.set('since', new Date(`${dateFrom}T00:00:00`).toISOString())
    if (dateTo) p.set('until', new Date(new Date(`${dateTo}T00:00:00`).getTime() + 86_400_000).toISOString())
    return p
  }

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      const res = await apiFetch(`/fires/resolutions/export?${buildFilterParams()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `fire-history${dateFrom ? '_' + dateFrom : ''}${dateTo ? '_' + dateTo : ''}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.warn('[HistoryPage] export failed:', e)
      setError('ดาวน์โหลดไม่สำเร็จ')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const params = buildFilterParams()
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(page * PAGE_SIZE))
    ;(async () => {
      try {
        const res = await apiFetch(`/fires/resolutions?${params}`)
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
  }, [page, kind, province, dateFrom, dateTo, search, reload])

  if (!can(user, 'fires.history')) return <Navigate to="/" replace />

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">
      {/* Page header and detail */}
      <div className='flex flex-row gap-4 items-center'>
        <h1 className='mt-2 pl-2 font-bold text-3xl text-primary'>ประวัติการดับไฟ</h1>
        <p className='font-medium text-md text-accent'>รายการจุดไฟที่ดำเนินการเสร็จสิ้นแล้ว</p>
      </div>

      {/* Page content container */}
      <div className="flex flex-col flex-1 min-h-0 w-full bg-foreground rounded-2xl p-4 shadow-md">

        {/* Table head (filter bar) */}
        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-300">
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value); setPage(0) }}
            className={`${SELECT_CLS} max-w-fit`}
          >
            <option value="">ทั้งหมด</option>
            <option value="false">ดับแล้ว</option>
            <option value="true">ไม่ใช่ไฟ</option>
          </select>

          <select
            value={province}
            onChange={(e) => { setProvince(e.target.value); setPage(0) }}
            className={`${SELECT_CLS} max-w-fit`}
          >
            <option value="">ทุกจังหวัด</option>
            {provinces.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
              className={`${INPUT_CLS} max-w-fit text-accent`}
            />
            <span className="text-accent">–</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
              className={`${INPUT_CLS} max-w-fit text-accent`}
            />
          </div>

          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="text-md font-semibold text-blue-400 hover:text-blue-700 px-2 py-1.5 disabled:opacity-40"
          >
            {downloading ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลด'}
          </button>

          <form
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(0) }}
            className="ml-auto flex flex-row w-78 items-center gap-2"
          >
            <input
              type="text"
              value={searchInput}
              title="ค้นหาด้วยชื่อจุดไฟ ชื่อเจ้าหน้าที่ หรือที่ตั้ง"
              onChange={(e) => setSearchInput(e.target.value)}
              onBlur={() => { setSearch(searchInput.trim()); setPage(0) }}
              placeholder="ค้นหาชื่อจุดไฟ เจ้าหน้าที่ หรือที่ตั้ง…"
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
            <p className="text-gray-400">ยังไม่มีประวัติการดับไฟ</p>
          )}

          {items !== null && !error && items.length > 0 && (
            <div className="flex-1 min-h-0 overflow-auto minimal-scrollbar">
              <table className="w-full table-fixed text-left border-collapse">
                <colgroup>
                  <col className="w-24" />
                  <col className="w-32" />
                  <col className="w-64" />
                  <col className="w-48" />
                  <col />
                  <col className="w-32" />
                </colgroup>
                <thead className={THEAD_CLS}>
                  <tr className="text-accent text-sm">
                    <th className="px-3 py-2 font-medium">สถานะ</th>
                    <th className="px-3 py-2 font-medium">จุดไฟ</th>
                    <th className="px-3 py-2 font-medium">ที่ตั้ง</th>
                    <th className="px-3 py-2 font-medium">ดับโดย</th>
                    <th className="px-3 py-2 font-medium">รายละเอียด</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">เวลาดับ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.fire_id} className="border-b border-background hover:bg-background/50">
                      <td className="px-3 py-2.5 align-top">
                        <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${it.false_alarm ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                          {it.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm font-medium text-gray-900 wrap-break-word">
                        {it.name}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 font-light wrap-break-word">
                        {[it.tumboon, it.aumper, it.province].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 font-light break-all">
                        {it.officer_name ?? 'ไม่ทราบ'}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 font-light whitespace-pre-line wrap-break-word">
                        {it.note || '—'}
                        {it.images.length > 0 && (
                          <div className="mt-1 flex gap-1.5 flex-wrap">
                            {it.images.map(({ id, content_type }) => {
                              const path = `/fires/${it.fire_id}/images/${id}`
                              const url = `${API_URL}${path}`
                              const isVideo = content_type?.startsWith('video/')
                              const filename = `evidence-${id}.${EXT[content_type] ?? 'bin'}`
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => setViewer({ path, url, isVideo, filename })}
                                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-black"
                                >
                                  {isVideo ? (
                                    <>
                                      <video src={url} muted preload="metadata" className="h-16 w-16 object-cover" />
                                      <span className="absolute inset-0 flex items-center justify-center">
                                        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white/90 drop-shadow">
                                          <path d="M8 5v14l11-7z" />
                                        </svg>
                                      </span>
                                    </>
                                  ) : (
                                    <img src={url} alt="หลักฐาน" className="h-16 w-16 object-cover" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top text-sm text-gray-500 whitespace-nowrap text-right">
                        {formatEventTime(it.resolved_at)}
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

      {/* Full-screen evidence viewer — click backdrop to close (mirrors the mobile app) */}
      {viewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setViewer(null)}
        >
          {viewer.isVideo ? (
            <video
              src={viewer.url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-[90vw]"
            />
          ) : (
            <img
              src={viewer.url}
              alt="หลักฐาน"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-[90vw] object-contain"
            />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); saveEvidence(viewer.path, viewer.filename) }}
            disabled={savingEvidence}
            className="absolute right-20 top-5 flex h-10 items-center rounded-full bg-white/90 px-4 text-sm font-semibold text-gray-900 hover:bg-white disabled:opacity-50"
          >
            {savingEvidence ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลด'}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setViewer(null) }}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-2xl text-white hover:bg-black/70"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
