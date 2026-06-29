import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSocketStore } from '../lib/stateStore'
import { useAuthStore, can } from '../lib/useAuthStore'
import { toast } from '../lib/toastStore'
import { useMessageEffect } from '../lib/useMessageEffect'
import { apiFetch, ERROR_MESSAGES, INPUT_CLS, SELECT_CLS, USERNAME_PATTERN, errorText, isValidUsername } from '../lib/shared'

const regionLabel = (r) => r.name_th

// region picker order: broadest scope first, then alphabetical by Thai name
const REGION_LEVEL_ORDER = { national: 0, regional: 1, province: 2 }
const byRegion = (a, b) =>
  (REGION_LEVEL_ORDER[a.level] ?? 99) - (REGION_LEVEL_ORDER[b.level] ?? 99) ||
  (a.name_th ?? '').localeCompare(b.name_th ?? '', 'th')

// Console permissions a dispatcher can be granted (mirrors backend ALL_PERMISSIONS).
const PERMISSION_OPTIONS = [
  { id: 'officers.view', label: 'มองเห็นเจ้าหน้าที่' },
  { id: 'officer.manage', label: 'จัดการเจ้าหน้าที่' },
  { id: 'officer.verify', label: 'อนุมัติเจ้าหน้าที่ที่รอยืนยัน' },
  { id: 'region_requests.view', label: 'ดูคำขอย้ายพื้นที่' },
  { id: 'fire.appoint', label: 'มอบหมายงานดับไฟ' },
  { id: 'region_request.decide', label: 'อนุมัติคำขอย้ายพื้นที่' },
  { id: 'fires.history', label: 'ดูประวัติการดับไฟ' },
  { id: 'dispatchers.view', label: 'มองเห็นผู้ดูแล' },
  // dispatcher.manage / permission.grant are superuser-only — not delegatable
]
// Default checkboxes = the backend "dispatcher" preset.
const DISPATCHER_DEFAULT = [
  'fires.view', 'officers.view', 'region_requests.view', 'officer.verify',
  'officer.manage', 'fire.appoint', 'region_request.decide', 'fires.history'
]

// Action → implied view permissions (mirrors backend IMPLIES in
// db_control/permission.py). Holding an action permission auto-grants the views
// it reads, so we surface those as checked & locked rather than letting an admin
// uncheck a view the backend will re-grant anyway.
const IMPLIES = {
  'officer.verify': ['officers.view'],
  'officer.manage': ['officers.view'],
  'fire.appoint': ['officers.view', 'fires.view'],
  'region_requests.view': ['officers.view'],
  'region_request.decide': ['region_requests.view', 'officers.view'],
  'dispatcher.manage': ['dispatchers.view'],
}

// The set of view permissions auto-granted by the currently-checked permissions.
const impliedPerms = (perms) => {
  const out = new Set()
  for (const p of perms) for (const v of IMPLIES[p] ?? []) out.add(v)
  return out
}

// Every permission an admin can explicitly tick (used by the "select all" button).
const ALL_PERMISSION_IDS = PERMISSION_OPTIONS.map((p) => p.id)

// Permission checkbox group shared by the create and edit forms. Permissions
// implied by a checked action permission render checked, locked, and tagged so
// the admin sees they're included automatically. `onSet` replaces the whole list
// (for the bulk buttons); `revertTo` is the list to restore on "revert".
function PermissionFields({ perms, onToggle, onSet, revertTo }) {
  const implied = impliedPerms(perms)
  return (
    <fieldset className="border border-gray-200 rounded-lg p-3">
      <legend className="text-sm text-gray-600 px-1">สิทธิ์การใช้งาน</legend>
      <div className="flex flex-wrap gap-2 mb-2">
        <button
          type="button"
          onClick={() => onSet([...ALL_PERMISSION_IDS])}
          className="text-xs text-primary hover:underline"
        >
          เลือกทั้งหมด
        </button>
        <span className="text-gray-300">·</span>
        <button
          type="button"
          onClick={() => onSet([])}
          className="text-xs text-gray-500 hover:underline"
        >
          ยกเลิกทั้งหมด
        </button>
        <span className="text-gray-300">·</span>
        <button
          type="button"
          onClick={() => onSet([...(revertTo ?? [])])}
          className="text-xs text-gray-500 hover:underline"
        >
          คืนค่าเดิม
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {PERMISSION_OPTIONS.map((p) => {
          const auto = implied.has(p.id)
          return (
            <label
              key={p.id}
              title={auto ? 'อัตโนมัติจากสิทธิ์ที่เลือก' : undefined}
              className={`flex items-center gap-2 text-sm ${auto ? 'text-primary' : 'text-gray-700'}`}
            >
              <input
                type="checkbox"
                checked={perms.includes(p.id) || auto}
                disabled={auto}
                onChange={() => onToggle(p.id)}
                className="rounded border-gray-300 text-brand focus:ring-primary disabled:opacity-60"
              />
              {p.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const PAGE_SIZE = 20

// Superuser-only: provision, edit, and remove dispatcher accounts, each scoped
// to one region (regional office or province).
export default function DispatcherPage() {
  const user = useAuthStore((s) => s.user)
  const send = useSocketStore((s) => s.send)
  // create/edit/delete + permission granting are superuser-only (matches backend)
  const canManage = user?.is_superuser
  const dispatchersMsg = useSocketStore((s) => s.byType?.dispatchers)
  const createdMsg = useSocketStore((s) => s.byType?.dispatcher_created)
  const updatedMsg = useSocketStore((s) => s.byType?.dispatcher_updated)
  const deletedMsg = useSocketStore((s) => s.byType?.dispatcher_deleted)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [dispatchers, setDispatchers] = useState(null) // null = loading
  const [regions, setRegions] = useState(null) // assignment options
  const [query, setQuery] = useState('') // search by name/username/division/region
  const [sort, setSort] = useState('name') // 'name' = by display name, 'new' = by date added
  const [dir, setDir] = useState('asc') // 'asc' | 'desc'
  const [page, setPage] = useState(0)

  // create form
  const [creating, setCreating] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newName, setNewName] = useState('')
  const [newDivision, setNewDivision] = useState('') // สังกัด
  const [newPassword, setNewPassword] = useState('')
  const [newRegion, setNewRegion] = useState('') // Region.id
  const [newPerms, setNewPerms] = useState(DISPATCHER_DEFAULT)

  // inline edit
  const [editingId, setEditingId] = useState(null) // dispatcher user_id
  const [editName, setEditName] = useState('')
  const [editDivision, setEditDivision] = useState('') // สังกัด
  const [editUsername, setEditUsername] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editRegion, setEditRegion] = useState('')
  const [editPerms, setEditPerms] = useState([])
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { send({ type: 'list_dispatchers' }) }, [send])

  useEffect(() => {
    if (!dispatchersMsg) return
    setDispatchers(dispatchersMsg.dispatchers ?? [])
  }, [dispatchersMsg])

  useMessageEffect(createdMsg, () => {
    setCreating(false)
    setNewUsername(''); setNewName(''); setNewDivision(''); setNewPassword(''); setNewRegion('')
    setNewPerms(DISPATCHER_DEFAULT)
    toast.success('สร้างผู้ดูแลสำเร็จ')
  })

  useMessageEffect(updatedMsg, () => {
    setEditingId(null)
    setSavingId(null)
    toast.success('บันทึกข้อมูลผู้ดูแลแล้ว')
  })

  useMessageEffect(deletedMsg, (m) => {
    setDispatchers((prev) => prev ? prev.filter((d) => d.user_id !== m.user_id) : prev)
    setEditingId(null)
    setDeletingId(null)
    toast.success('ลบผู้ดูแลแล้ว')
  })

  useMessageEffect(errorMsg, (m) => {
    setCreating(false)
    setSavingId(null)
    setDeletingId(null)
    toast.error(errorText(m.code))
  })

  // region options, fetched once and sorted (national → regional → province,
  // then by Thai name) so a dispatcher can be scoped to any level incl. nationwide
  useEffect(() => {
    if (regions !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/regions')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setRegions([...data].sort(byRegion))
      } catch (e) {
        console.warn('[DispatcherPage] regions load failed:', e)
        if (!cancelled) setRegions([])
      }
    })()
    return () => { cancelled = true }
  }, [regions])

  if (!can(user, 'dispatchers.view')) return <Navigate to="/" replace />

  const toggle = (id) => (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const togglePerm = (id) => setNewPerms(toggle(id))
  const toggleEditPerm = (id) => setEditPerms(toggle(id))

  const createDispatcher = (e) => {
    e.preventDefault()
    if (!isValidUsername(newUsername)) { toast.error(ERROR_MESSAGES.invalid_username); return }
    if (!newRegion) { toast.error(ERROR_MESSAGES.invalid_region); return }
    setCreating(true)
    send({ type: 'create_dispatcher', username: newUsername, password: newPassword, name: newName, division: newDivision, region_id: newRegion, permissions: newPerms })
  }

  const clearCreateForm = () => {
    setNewUsername(''); setNewName(''); setNewDivision(''); setNewPassword(''); setNewRegion('')
    setNewPerms(DISPATCHER_DEFAULT)
  }

  const startEdit = (d) => {
    setEditingId(d.user_id)
    setEditName(d.name ?? '')
    setEditDivision(d.division ?? '')
    setEditUsername(d.username ?? '')
    setEditPassword('')
    setEditRegion(d.region_id ?? '')
    setEditPerms(d.permissions ?? [])
  }

  const saveEdit = (d) => {
    if (!isValidUsername(editUsername)) { toast.error(ERROR_MESSAGES.invalid_username); return }
    setSavingId(d.user_id)
    const payload = { type: 'update_dispatcher', user_id: d.user_id, name: editName, username: editUsername, division: editDivision, permissions: editPerms }
    if (editRegion) payload.region_id = editRegion
    if (editPassword) payload.password = editPassword
    send(payload)
  }

  const removeDispatcher = (d) => {
    if (!window.confirm(`ลบผู้ดูแล ${d.name ?? d.username}?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    setDeletingId(d.user_id)
    send({ type: 'delete_dispatcher', user_id: d.user_id })
  }

  const loading = dispatchers === null

  const q = query.trim().toLowerCase()
  const filteredDispatchers = (dispatchers ?? []).filter((d) => {
    if (!q) return true
    return (
      (d.name ?? '').toLowerCase().includes(q) ||
      (d.username ?? '').toLowerCase().includes(q) ||
      (d.division ?? '').toLowerCase().includes(q) ||
      (d.region_name_th ?? '').toLowerCase().includes(q)
    )
  })
  const dispatcherCols = canManage ? 4 : 3

  // Sort the filtered list by the chosen field, ascending, then flip for 'desc'.
  // 'name' = Thai collation on display name (falling back to username); 'new' =
  // the assignment's created_at (asc = oldest first, desc = newest first).
  const cmp =
    sort === 'new'
      ? (a, b) => new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0)
      : (a, b) => (a.name ?? a.username ?? '').localeCompare(b.name ?? b.username ?? '', 'th')
  const sortedDispatchers = [...filteredDispatchers].sort(
    (a, b) => (dir === 'desc' ? -cmp(a, b) : cmp(a, b)))

  // Client-side pagination over the sorted list (the full list arrives via the
  // socket). Clamp the page if filtering/deletion shrinks the result set.
  const total = sortedDispatchers.length
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0)
  const safePage = Math.min(page, lastPage)
  const pagedDispatchers = sortedDispatchers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  if (page !== safePage) setPage(safePage)

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3 px-5 py-3 lg:px-8">

      {/* Page header and description */}
      <div className='flex flex-row gap-4 items-center'>
        <h1 className='mt-2 pl-2 font-bold text-3xl text-primary'>ผู้ดูแล</h1>
        <p className='font-medium text-md text-accent'>ผู้ดูแลประจำพื้นที่ (สร้าง แก้ไข และลบบัญชี)</p>
      </div>

      <div className="flex-1 min-h-0 w-full flex flex-row gap-4 ">

        {/* Dispatchers list container (Inspect/Edit/Delete) */}
        <div className="flex-1 flex flex-col min-h-0 bg-foreground h-full rounded-2xl max-w-3/3 p-4 shadow-md">

          {/* Title + search */}
          <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center justify-between gap-4">
            <p className="font-medium text-accent text-lg whitespace-nowrap">ผู้ดูแลประจำพื้นที่ ({dispatchers?.length ?? 0})</p>
            <div className="flex flex-row items-center gap-2">
              <div className="flex flex-row gap-2 border border-gray-300 p-1.5 rounded-xl">
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value); setPage(0) }}
                  title="เรียงลำดับ"
                  className={`${SELECT_CLS} w-fit! text-accent`}
                >
                  <option value="name">ตามชื่อ</option>
                  <option value="new">ตามเวลาที่เพิ่ม</option>
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
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0) }}
                placeholder="ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือพื้นที่"
                title="ค้นหาชื่อ ชื่อผู้ใช้ สังกัด หรือพื้นที่"
                autoComplete="off"
                className={`${INPUT_CLS} max-w-56 text-accent`}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar">
            {loading ? (
              <div className="h-full flex justify-center items-center">
                <p className="text-gray-400">กำลังโหลด…</p>
              </div>
            ) : dispatchers.length === 0 ? (
              <div className="h-full flex justify-center items-center">
                <p className="text-gray-400">ยังไม่มีผู้ดูแล</p>
              </div>
            ) : filteredDispatchers.length === 0 ? (
              <div className="h-full flex justify-center items-center">
                <p className="text-gray-400">ไม่พบผู้ดูแลที่ตรงกับการค้นหา</p>
              </div>
            ) : (
              <table className="w-full table-fixed text-left border-collapse">
                <thead className="sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]">
                  <tr className="text-accent text-sm">
                    <th title="ชื่อ / ชื่อผู้ใช้" className="px-3 py-2 font-medium w-[24%]">ชื่อ / ชื่อผู้ใช้</th>
                    <th title="สังกัด" className="px-3 py-2 font-medium w-[24%]">สังกัด</th>
                    <th title="พื้นที่รับผิดชอบ" className="px-3 py-2 font-medium w-[52 %]">พื้นที่รับผิดชอบ</th>
                    {canManage && <th className="px-3 py-2 font-medium w-20"></th>}
                  </tr>
                </thead>
                <tbody>
                  {pagedDispatchers.map((d) => (
                    editingId === d.user_id ? (
                      <tr key={d.user_id}>
                        <td colSpan={dispatcherCols} className="px-3 py-3">
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
                              placeholder="ชื่อผู้ดูแล"
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
                              value={editRegion}
                              onChange={(e) => setEditRegion(e.target.value)}
                              className={SELECT_CLS}
                            >
                              {(regions ?? []).map((r) => (
                                <option key={r.id} value={r.id}>{regionLabel(r)}</option>
                              ))}
                            </select>
                            <PermissionFields perms={editPerms} onToggle={toggleEditPerm} onSet={setEditPerms} revertTo={d.permissions ?? []} />
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
                                onClick={() => removeDispatcher(d)}
                                disabled={deletingId === d.user_id}
                                className="text-sm text-destructive hover:text-white hover:bg-destructive border-2 rounded-full px-3 py-1.5 disabled:opacity-50"
                              >
                                {deletingId === d.user_id ? 'กำลังลบ…' : 'ลบผู้ดูแล'}
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
                                  onClick={() => saveEdit(d)}
                                  disabled={savingId === d.user_id}
                                  className="bg-primary hover:bg-brand text-white rounded-xl px-4 py-1.5 text-sm disabled:opacity-50"
                                >
                                  {savingId === d.user_id ? 'กำลังบันทึก…' : 'บันทึก'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={d.user_id} className="border-b border-background hover:bg-background/50">
                        <td className="px-3 py-2.5">
                          <p title={d.name ?? d.username} className="text-md text-primary font-medium truncate">{d.name ?? d.username}</p>
                          <p title={d.username} className="text-sm text-gray-500 font-light truncate">{d.username}</p>
                        </td>
                        <td title={d.division || '—'} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{d.division || '—'}</td>
                        <td title={d.region_name_th} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{d.region_name_th}</td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => startEdit(d)}
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

          {!loading && filteredDispatchers.length > 0 && (
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

        {/* Create dispatcher (separate container) */}
        {canManage && (
          <div className="flex-1 flex flex-col min-h-0  bg-foreground h-full rounded-2xl max-w-1/3 p-4 shadow-md">

            {/* Title */}
            <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center justify-between gap-4">
              <p className="font-medium text-accent text-lg">สร้างผู้ดูแลใหม่</p>
            </div>

            <div className="flex-1 min-h-0 px-2">
              <form onSubmit={createDispatcher} className="space-y-2 text-accent">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="ชื่อผู้ใช้"
                  autoComplete="off"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern={USERNAME_PATTERN}
                  title={ERROR_MESSAGES.invalid_username}
                  className={INPUT_CLS}
                />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ชื่อผู้ดูแล"
                  className={INPUT_CLS}
                />
                <input
                  type="text"
                  value={newDivision}
                  onChange={(e) => setNewDivision(e.target.value)}
                  placeholder="สังกัด"
                  className={INPUT_CLS}
                />
                <select
                  value={newRegion}
                  onChange={(e) => setNewRegion(e.target.value)}
                  required
                  className={SELECT_CLS}
                >
                  <option value="">— เลือกพื้นที่รับผิดชอบ —</option>
                  {(regions ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{regionLabel(r)}</option>
                  ))}
                </select>
                <PermissionFields perms={newPerms} onToggle={togglePerm} onSet={setNewPerms} revertTo={DISPATCHER_DEFAULT} />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
                  autoComplete="new-password"
                  required
                  className={INPUT_CLS}
                />
                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={clearCreateForm}
                    disabled={creating}
                    className="border border-gray-300 text-accent hover:bg-gray-100 rounded-xl px-4 py-1.5 text-sm disabled:opacity-50"
                  >
                    ล้างทั้งหมด
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="bg-primary hover:bg-brand text-white rounded-xl px-4 py-1.5 text-sm disabled:opacity-50"
                  >
                    {creating ? 'กำลังสร้าง…' : 'สร้างผู้ดูแล'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
