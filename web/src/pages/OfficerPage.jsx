import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSocketStore, useMapSelection } from '../lib/stateStore'
import { useAuthStore, can } from '../lib/useAuthStore'
import { toast } from '../lib/toastStore'
import { useMessageEffect } from '../lib/useMessageEffect'
import { ERROR_MESSAGES, INPUT_CLS, SELECT_CLS, USERNAME_PATTERN, errorText, isValidUsername } from '../lib/shared'
import { useRegions } from '../lib/useRegions'

const PAGE_SIZE = 20

// last-active timestamp shown under an officer's online status
const LAST_SEEN_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})
const formatLastSeen = (value) => {
  if (!value) return ''
  const d = new Date(value)
  return isNaN(d) ? '' : `${LAST_SEEN_FORMAT.format(d)} น.`
}

export default function OfficerPage() {
  const user = useAuthStore((s) => s.user)
  const send = useSocketStore((s) => s.send)
  const navigate = useNavigate()
  const setFocusedFire = useMapSelection((s) => s.setFocused)
  const canManage = can(user, 'officer.manage')
  const canVerify = can(user, 'officer.verify')
  const canViewReq = can(user, 'region_requests.view')
  const canDecide = can(user, 'region_request.decide')

  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const updatedMsg = useSocketStore((s) => s.byType?.officer_updated)
  const deletedMsg = useSocketStore((s) => s.byType?.officer_deleted)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const requestsMsg = useSocketStore((s) => s.byType?.region_change_requests)
  const decidedMsg = useSocketStore((s) => s.byType?.region_request_decided)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  // verified officers + inline edit
  const [officers, setOfficers] = useState([])
  const [query, setQuery] = useState('') // search by name/username/division/province
  const [statusFilter, setStatusFilter] = useState('all') // all | online | offline
  const [sort, setSort] = useState('name') // 'name' = by display name, 'new' = by date added
  const [dir, setDir] = useState('asc') // 'asc' | 'desc'
  const [page, setPage] = useState(0)
  const { provinces } = useRegions() // null = not loaded yet
  const [editingId, setEditingId] = useState(null) // user_id being edited
  const [editName, setEditName] = useState('')
  const [editDivision, setEditDivision] = useState('') // สังกัด
  const [editProvince, setEditProvince] = useState('') // Region.code
  const [editUsername, setEditUsername] = useState('')
  const [editPassword, setEditPassword] = useState('') // blank = keep current
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  // pending verification + region-change requests
  const [pending, setPending] = useState(null) // null = loading
  const [requests, setRequests] = useState(null) // region-change requests
  const [busyId, setBusyId] = useState(null)
  const [pendingQuery, setPendingQuery] = useState('') // search pending by name/username/division/province
  const [requestQuery, setRequestQuery] = useState('') // search requests by name/username/province

  useEffect(() => {
    send({ type: 'list_officers' })
    send({ type: 'list_pending_officers' })
    if (canViewReq) send({ type: 'list_region_requests' })
  }, [send, canViewReq])

  useEffect(() => {
    if (!officersMsg) return
    setOfficers(officersMsg.officers ?? [])
  }, [officersMsg])

  useEffect(() => {
    if (!pendingMsg) return
    setPending(pendingMsg.officers ?? [])
  }, [pendingMsg])

  useEffect(() => {
    if (!requestsMsg) return
    setRequests(requestsMsg.requests ?? [])
  }, [requestsMsg])

  useMessageEffect(updatedMsg, () => {
    setEditingId(null)
    setSavingId(null)
    toast.success('บันทึกข้อมูลเจ้าหน้าที่แล้ว')
  })

  useMessageEffect(deletedMsg, (m) => {
    const wasPending = (pending ?? []).some((o) => o.user_id === m.user_id)
    setOfficers((prev) => prev.filter((o) => o.user_id !== m.user_id))
    setPending((prev) => prev ? prev.filter((o) => o.user_id !== m.user_id) : prev)
    setEditingId(null)
    setDeletingId(null)
    setBusyId(null)
    toast.success(wasPending ? 'ไม่อนุมัติการลงทะเบียนแล้ว' : 'ลบเจ้าหน้าที่แล้ว')
  })

  useMessageEffect(verifiedMsg, (m) => {
    setPending((prev) => prev ? prev.filter((o) => o.user_id !== m.user_id) : prev)
    setBusyId(null)
    toast.success('ยืนยันเจ้าหน้าที่สำเร็จ')
  })

  useMessageEffect(decidedMsg, (m) => {
    setRequests((prev) => prev ? prev.filter((r) => r.request_id !== m.request_id) : prev)
    setBusyId(null)
    toast.success(m.status === 'approved' ? 'อนุมัติการย้ายพื้นที่แล้ว' : 'ปฏิเสธคำขอแล้ว')
  })

  useMessageEffect(errorMsg, (m) => {
    setSavingId(null)
    setDeletingId(null)
    setBusyId(null)
    toast.error(errorText(m.code))
  })

  if (!can(user, 'officers.view')) return <Navigate to="/" replace />

  const startEdit = (o) => {
    setEditingId(o.user_id)
    setEditName(o.name ?? '')
    setEditDivision(o.division ?? '')
    setEditProvince((provinces ?? []).find((p) => p.path === o.province_path)?.code ?? '')
    setEditUsername(o.username ?? '')
    setEditPassword('')
  }

  const saveEdit = (o) => {
    if (!isValidUsername(editUsername)) { toast.error(ERROR_MESSAGES.invalid_username); return }
    setSavingId(o.user_id)
    const payload = { type: 'update_officer', user_id: o.user_id, name: editName, username: editUsername, division: editDivision }
    if (editProvince) payload.province_code = editProvince
    if (editPassword) payload.password = editPassword
    send(payload)
  }

  const removeOfficer = (o) => {
    if (!window.confirm(`ลบเจ้าหน้าที่ ${o.name ?? o.username}?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    setDeletingId(o.user_id)
    send({ type: 'delete_officer', user_id: o.user_id })
  }

  const verify = (id) => {
    setBusyId(id)
    send({ type: 'verify_officer', user_id: id })
  }

  // busy officer (holds a fire) → jump to that fire on the map, like the dashboard
  const goToSpot = (o) => {
    if (!o.fire_id) return
    setFocusedFire(o.fire_id)
    navigate('/map')
  }

  const reject = (o) => {
    if (!window.confirm(`ไม่อนุมัติการลงทะเบียนของ ${o.name ?? o.username}?\nบัญชีนี้จะถูกลบและไม่สามารถย้อนกลับได้`)) return
    setBusyId(o.user_id)
    send({ type: 'delete_officer', user_id: o.user_id })
  }

  const decide = (requestId, action) => {
    setBusyId(requestId)
    send({ type: 'decide_region_request', request_id: requestId, action })
  }

  const loadingPending = pending === null
  const loadingRequests = requests === null

  const q = query.trim().toLowerCase()
  const filteredOfficers = officers.filter((o) => {
    if (statusFilter === 'online' && !o.active) return false
    if (statusFilter === 'offline' && o.active) return false
    if (statusFilter === 'busy' && !o.fire_id) return false
    if (!q) return true
    return (
      (o.name ?? '').toLowerCase().includes(q) ||
      (o.username ?? '').toLowerCase().includes(q) ||
      (o.division ?? '').toLowerCase().includes(q) ||
      (o.province_name_th ?? '').toLowerCase().includes(q)
    )
  })
  const officerCols = canManage ? 5 : 4

  // Sort the filtered verified officers by the chosen field, ascending, then
  // flip for 'desc'. 'name' = Thai collation on display name (falling back to
  // username); 'new' = region assignment's created_at (asc oldest, desc newest).
  const cmp =
    sort === 'new'
      ? (a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0)
      : sort === 'updated'
      ? (a, b) => new Date(a.last_updated ?? 0) - new Date(b.last_updated ?? 0)
      : (a, b) => (a.name ?? a.username ?? '').localeCompare(b.name ?? b.username ?? '', 'th')
  const sortedOfficers = [...filteredOfficers].sort(
    (a, b) => (dir === 'desc' ? -cmp(a, b) : cmp(a, b)))

  // Client-side pagination over the sorted list (the full list arrives via the
  // socket). Clamp the page if filtering/deletion shrinks the result set.
  const total = sortedOfficers.length
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0)
  const safePage = Math.min(page, lastPage)
  const pagedOfficers = sortedOfficers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  if (page !== safePage) setPage(safePage)

  const pq = pendingQuery.trim().toLowerCase()
  const filteredPending = (pending ?? []).filter((o) => {
    if (!pq) return true
    return (
      (o.name ?? '').toLowerCase().includes(pq) ||
      (o.username ?? '').toLowerCase().includes(pq) ||
      (o.division ?? '').toLowerCase().includes(pq) ||
      (o.province_name_th ?? '').toLowerCase().includes(pq)
    )
  })

  const rq = requestQuery.trim().toLowerCase()
  const filteredRequests = (requests ?? []).filter((r) => {
    if (!rq) return true
    return (
      (r.officer_name ?? '').toLowerCase().includes(rq) ||
      (r.username ?? '').toLowerCase().includes(rq) ||
      (r.current_province ?? '').toLowerCase().includes(rq) ||
      (r.requested_province ?? '').toLowerCase().includes(rq)
    )
  })

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">

        {/* Page header and description */}
        <div className='flex flex-row gap-4 items-center'>
          <h1 className='mt-2 pl-2 font-bold text-3xl text-primary'>เจ้าหน้าที่</h1>
          <p className='font-medium text-md text-accent'>รายการเจ้าที่ในขอบเขตที่ดูแล</p>
        </div>

        <div className="flex-1 min-h-0 w-full flex flex-row gap-4 ">

          {/* Officers list container (Inspect/Edit/Delete) */}
          <div className="flex-1 flex flex-col min-h-0 bg-foreground h-full rounded-2xl max-w-1/2 p-4 shadow-md">

            {/* Title + search */}
            <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center justify-between gap-4">
              <p className="font-medium text-accent text-lg whitespace-nowrap">เจ้าหน้าที่ในเขตของคุณ ({officers.length})</p>
              <div className="flex flex-row items-center gap-2">
                <div className="flex flex-row gap-2 border border-gray-300 p-1.5 rounded-xl">
                  <select
                    value={sort}
                    onChange={(e) => { setSort(e.target.value); setPage(0) }}
                    title="เรียงลำดับ"
                    className={`${SELECT_CLS} w-fit!`}
                  >
                    <option value="name">ตามชื่อ</option>
                    <option value="new">ตามเวลาที่เพิ่ม</option>
                    <option value="updated">ตามการอัปเดต</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => { setDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(0) }}
                    title={dir === 'asc' ? 'จากน้อยไปมาก' : 'จากมากไปน้อย'}
                    className="px-2 py-1.5 rounded-lg border border-gray-300 text-accent hover:bg-gray-50"
                  >
                    {dir === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
                  className={`${SELECT_CLS} max-w-fit`}
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="online">ออนไลน์</option>
                  <option value="offline">ออฟไลน์</option>
                  <option value="busy">มีงานอยู่</option>
                </select>
                <input
                  type="text"
                  value={query}
                  title='ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือจังหวัด'
                  onChange={(e) => { setQuery(e.target.value); setPage(0) }}
                  placeholder="ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือจังหวัด"
                  autoComplete="off"
                  className={`${INPUT_CLS} w-40 text-accent`}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar">
              {officers.length === 0 ? (
                <div className="h-full flex justify-center items-center">
                  <p className="text-gray-400">ยังไม่มีเจ้าหน้าที่ที่ได้รับการยืนยัน</p>
                </div>
              ) : filteredOfficers.length === 0 ? (
                <div className="h-full flex justify-center items-center">
                  <p className="text-gray-400">ไม่พบเจ้าหน้าที่ที่ตรงกับการค้นหา</p>
                </div>
              ) : (
                <table className="w-full table-fixed text-left border-collapse">
                  <thead className="sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]">
                    <tr className="text-accent text-sm">
                      <th title="ชื่อ / ชื่อผู้ใช้" className="px-3 py-2 font-medium w-[34%]">ชื่อ / ชื่อผู้ใช้</th>
                      <th title="สังกัด" className="px-3 py-2 font-medium w-[26%]">สังกัด</th>
                      <th title="จังหวัด" className="px-3 py-2 font-medium w-[26%]">จังหวัด</th>
                      <th title="สถานะ" className="px-3 py-2 font-medium w-[14%]">สถานะ</th>
                      {canManage && <th className="px-3 py-2 font-medium w-20"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedOfficers.map((o) => (
                      editingId === o.user_id ? (
                        <tr key={o.field_officer_id} >
                          <td colSpan={officerCols} className="px-3 py-3">
                            <div className="space-y-2 text-accent">
                              <input
                                type="text"
                                value={editUsername}
                                onChange={(e) => setEditUsername(e.target.value)}
                                placeholder="ชื่อผู้ใช้"
                                autoComplete="off"
                                minLength={3}
                                maxLength={32}
                                pattern={USERNAME_PATTERN}
                                title={ERROR_MESSAGES.invalid_username}
                                className={INPUT_CLS}
                              />
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="ชื่อเจ้าหน้าที่"
                                className={INPUT_CLS}
                              />
                              <input
                                type="text"
                                value={editDivision}
                                onChange={(e) => setEditDivision(e.target.value)}
                                placeholder="สังกัด"
                                className={INPUT_CLS}
                              />
                              <select
                                value={editProvince}
                                onChange={(e) => setEditProvince(e.target.value)}
                                className={SELECT_CLS}
                              >
                                <option value="">— จังหวัดเดิม —</option>
                                {(provinces ?? []).map((p) => (
                                  <option key={p.code} value={p.code}>{p.name_th}</option>
                                ))}
                              </select>
                              <input
                                type="password"
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                placeholder="ตั้งรหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)"
                                autoComplete="new-password"
                                className={INPUT_CLS}
                              />
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => removeOfficer(o)}
                                  disabled={deletingId === o.user_id}
                                  className="text-sm text-destructive hover:text-white hover:bg-destructive border-2 rounded-full px-3 py-1.5 disabled:opacity-50"
                                >
                                  {deletingId === o.user_id ? 'กำลังลบ…' : 'ลบเจ้าหน้าที่'}
                                </button>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="text-sm text-gray-500 hover:text-accent px-3 py-1.5"
                                  >
                                    ยกเลิก
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(o)}
                                    disabled={savingId === o.user_id}
                                    className="bg-primary hover:bg-brand text-white rounded-xl px-4 py-1.5 text-sm disabled:opacity-50"
                                  >
                                    {savingId === o.user_id ? 'กำลังบันทึก…' : 'บันทึก'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={o.field_officer_id} className="border-b border-background hover:bg-background/50">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              {o.fire_id && (
                                <span title="มีงานอยู่" className="shrink-0 w-2.5 h-2.5 rounded-full bg-yellow-400" />
                              )}
                              {o.fire_id ? (
                                <button type="button" onClick={() => goToSpot(o)} title="มีงานอยู่ — ดูบนแผนที่" className="min-w-0 text-left">
                                  <p className="text-md text-primary font-medium truncate hover:text-brand">{o.name ?? o.username}</p>
                                  <p className="text-sm text-gray-500 font-light truncate">{o.username}</p>
                                </button>
                              ) : (
                                <div className="min-w-0">
                                  <p title={o.name ?? o.username} className="text-md text-primary font-medium truncate">{o.name ?? o.username}</p>
                                  <p title={o.username} className="text-sm text-gray-500 font-light truncate">{o.username}</p>
                                </div>
                              )}
                            </div>
                          </td>
                          <td title={o.division || '—'} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{o.division || '—'}</td>
                          <td title={o.province_name_th} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{o.province_name_th}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-col items-start gap-1">
                              <span title={o.active ? 'ออนไลน์' : 'ออฟไลน์'} className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {o.active ? 'ออนไลน์' : 'ออฟไลน์'}
                              </span>
                              {o.last_updated && (
                                <span className="text-xs text-gray-500 font-light whitespace-nowrap">{formatLastSeen(o.last_updated)}</span>
                              )}
                            </div>
                          </td>
                          {canManage && (
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => startEdit(o)}
                                className="text-sm text-primary hover:text-brand border-2 border-flame hover:border-brand hover:bg-flame-light rounded-xl px-3 py-1.5"
                              >
                                แก้ไข
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {filteredOfficers.length > 0 && (
              <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-300 text-sm text-gray-600">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(0)}
                    disabled={safePage === 0}
                    className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                  >
                    หน้าแรก
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(p - 1, 0))}
                    disabled={safePage === 0}
                    className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                  >
                    ก่อนหน้า
                  </button>
                </div>
                <span>
                  {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, total)} จาก {total}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
                    disabled={safePage >= lastPage}
                    className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                  >
                    ถัดไป
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(lastPage)}
                    disabled={safePage >= lastPage}
                    className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                  >
                    หน้าสุดท้าย
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pending officers */}
          <div className="flex flex-col flex-1 rounded-2xl max-w-1/2 gap-4">

            {/* Approve registration */}
            <div className="flex-1 flex flex-col min-h-0 bg-foreground rounded-2xl max-w-full p-4 shadow-md">

              {/* Title + search */}
              <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center justify-between gap-4">
                <p className="font-medium text-accent text-lg">บัญชีที่รอการยืนยัน ({pending?.length ?? 0})</p>
                <input
                  type="text"
                  value={pendingQuery}
                  onChange={(e) => setPendingQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือจังหวัด"
                  title="ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือจังหวัด"
                  autoComplete="off"
                  className={`${INPUT_CLS} max-w-56 text-accent`}
                />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar">
                {loadingPending ? (
                  <div className="h-full flex justify-center items-center">
                    <p className="text-gray-400">กำลังโหลด…</p>
                  </div>
                ) : pending.length === 0 ? (
                  <div className="h-full flex justify-center items-center">
                    <p className="text-gray-400">ไม่มีบัญชีที่รอการยืนยัน</p>
                  </div>
                ) : filteredPending.length === 0 ? (
                  <div className="h-full flex justify-center items-center">
                    <p className="text-gray-400">ไม่พบบัญชีที่ตรงกับการค้นหา</p>
                  </div>
                ) : (
                  <table className="w-full table-fixed text-left border-collapse">
                    <thead className="sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]">
                      <tr className="text-accent text-sm">
                        <th title="ชื่อ / ชื่อผู้ใช้" className="px-3 py-2 font-medium w-[22%]">ชื่อ / ชื่อผู้ใช้</th>
                        <th title="สังกัด" className="px-3 py-2 font-medium w-[24%]">สังกัด</th>
                        <th title="จังหวัด" className="px-3 py-2 font-medium w-[22%]">จังหวัด</th>
                        {canVerify && <th className="px-3 py-2 font-medium w-fit"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPending.map((o) => (
                        <tr key={o.user_id} className="border-b border-background hover:bg-background/50">
                          <td className="px-3 py-2.5">
                            <p title={o.name ?? o.username} className="text-md text-primary font-medium truncate">{o.name ?? o.username}</p>
                            <p title={o.username} className="text-sm text-gray-500 font-light truncate">{o.username}</p>
                          </td>
                          <td title={o.division || '—'} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{o.division || '—'}</td>
                          <td title={o.province_name_th} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{o.province_name_th}</td>
                          {canVerify && (
                            <td className="px-3 py-2 text-right">
                              <div className="flex flex-row justify-end gap-2">

                                <button
                                  type="button"
                                  onClick={() => verify(o.user_id)}
                                  disabled={busyId === o.user_id}
                                  className="text-sm text-primary hover:text-brand border-2 border-flame hover:border-brand hover:bg-flame-light rounded-xl px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                                >
                                  {busyId === o.user_id ? 'กำลังยืนยัน…' : 'ยืนยัน'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reject(o)}
                                  disabled={busyId === o.user_id}
                                  className="text-sm text-red-600 hover:text-white border-2 border-red-300 hover:border-red-600 hover:bg-red-600 rounded-xl px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                                >
                                  ไม่อนุมัติ
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Approve region change request */}
            {canViewReq && (
              <div className="flex-1 flex flex-col min-h-0 bg-foreground rounded-2xl max-w-full p-4 shadow-md">

                {/* Title + search */}
                <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center justify-between gap-4">
                  <p className="font-medium text-accent text-lg">คำขอย้ายพื้นที่ ({requests?.length ?? 0})</p>
                  <input
                    type="text"
                    value={requestQuery}
                    onChange={(e) => setRequestQuery(e.target.value)}
                    placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรือจังหวัด"
                    title="ค้นหาชื่อ ชื่อผู้ใช้ หรือจังหวัด"
                    autoComplete="off"
                    className={`${INPUT_CLS} max-w-56 text-accent`}
                  />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar">
                  {loadingRequests ? (
                    <div className="h-full flex justify-center items-center">
                      <p className="text-gray-400">กำลังโหลด…</p>
                    </div>
                  ) : requests.length === 0 ? (
                    <div className="h-full flex justify-center items-center">
                      <p className="text-gray-400">ไม่มีคำขอย้ายพื้นที่</p>
                    </div>
                  ) : filteredRequests.length === 0 ? (
                    <div className="h-full flex justify-center items-center">
                      <p className="text-gray-400">ไม่พบคำขอที่ตรงกับการค้นหา</p>
                    </div>
                  ) : (
                    <table className="w-full table-fixed text-left border-collapse">
                      <thead className="sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]">
                        <tr className="text-accent text-sm">
                          <th title="ชื่อ / ชื่อผู้ใช้" className="px-3 py-2 font-medium w-[28%]">ชื่อ / ชื่อผู้ใช้</th>
                          <th title="สังกัด" className="px-3 py-2 font-medium w-[20%]">สังกัด</th>
                          <th title="การย้ายพื้นที่" className="px-3 py-2 font-medium w-[28%]">การย้ายพื้นที่</th>
                          {canDecide && <th className="px-3 py-2 font-medium w-[24%]"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRequests.map((r) => (
                          <tr key={r.request_id} className="border-b border-background hover:bg-background/50">
                            <td className="px-3 py-2.5">
                              <p title={r.officer_name ?? r.username} className="text-md text-primary font-medium truncate">{r.officer_name ?? r.username}</p>
                              <p title={r.username} className="text-sm text-gray-500 font-light truncate">{r.username}</p>
                            </td>
                            <td title={r.division || '—'} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{r.division || '—'}</td>
                            <td title={`${r.current_province} → ${r.requested_province}`} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{r.current_province} → {r.requested_province}</td>
                            {canDecide && (
                              <td className="px-3 py-2 text-right">
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => decide(r.request_id, 'approve')}
                                    disabled={busyId === r.request_id}
                                    className="text-sm text-primary hover:text-brand border-2 border-flame hover:border-brand hover:bg-flame-light rounded-xl px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                                  >
                                    อนุมัติ
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => decide(r.request_id, 'reject')}
                                    disabled={busyId === r.request_id}
                                    className="text-sm text-gray-500 hover:text-accent px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                                  >
                                    ปฏิเสธ
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

            )}
          </div>
        </div>
      </div>
    </div>
  )
}
