import { useEffect, useState } from 'react'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid'
import { useSocketStore } from '../../functions/stateStore'
import { useAuthStore } from '../../functions/useAuthStore'
import { toast } from '../../functions/toastStore'
import { useMessageEffect } from '../../functions/useMessageEffect'
import { API_URL, ERROR_MESSAGES, INPUT_CLS, REGION_LEVEL_TH, SELECT_CLS, errorText } from './shared'

const regionLabel = (r) => `${r.name_th} (${REGION_LEVEL_TH[r.level] ?? r.level})`

// Console permissions a dispatcher can be granted (mirrors backend ALL_PERMISSIONS).
const PERMISSION_OPTIONS = [
  { id: 'officers.view', label: 'ดูเจ้าหน้าที่' },
  { id: 'fires.view', label: 'ดูไฟ (แผนที่)' },
  { id: 'region_requests.view', label: 'ดูคำขอย้ายพื้นที่' },
  { id: 'dispatchers.view', label: 'ดูผู้ควบคุม' },
  { id: 'officer.verify', label: 'อนุมัติเจ้าหน้าที่ที่รอยืนยัน' },
  { id: 'officer.manage', label: 'จัดการเจ้าหน้าที่ (แก้ไข/ลบ)' },
  { id: 'fire.appoint', label: 'มอบหมายงานดับไฟ' },
  { id: 'region_request.decide', label: 'อนุมัติคำขอย้ายพื้นที่' },
  // dispatcher.manage / permission.grant are superuser-only — not delegatable
]
// Default checkboxes = the backend "dispatcher" preset.
const DISPATCHER_DEFAULT = [
  'officers.view', 'region_requests.view', 'officer.verify',
  'officer.manage', 'fire.appoint', 'region_request.decide',
]

// Superuser-only: provision, edit, and remove dispatcher accounts, each scoped
// to one region (regional office or province).
export default function DispatchersTab() {
  const send = useSocketStore((s) => s.send)
  // create/edit/delete + permission granting are superuser-only (matches backend)
  const canManage = useAuthStore((s) => s.user)?.is_superuser
  const dispatchersMsg = useSocketStore((s) => s.byType?.dispatchers)
  const createdMsg = useSocketStore((s) => s.byType?.dispatcher_created)
  const updatedMsg = useSocketStore((s) => s.byType?.dispatcher_updated)
  const deletedMsg = useSocketStore((s) => s.byType?.dispatcher_deleted)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [dispatchers, setDispatchers] = useState(null) // null = loading
  const [regions, setRegions] = useState(null) // assignment options

  // create form (collapsed behind a toggle until the superuser wants to add one)
  const [showCreate, setShowCreate] = useState(false)
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
    setShowCreate(false)
    setNewUsername(''); setNewName(''); setNewDivision(''); setNewPassword(''); setNewRegion('')
    setNewPerms(DISPATCHER_DEFAULT)
    toast.success('สร้างผู้ควบคุมสำเร็จ')
  })

  useMessageEffect(updatedMsg, () => {
    setEditingId(null)
    setSavingId(null)
    toast.success('บันทึกข้อมูลผู้ควบคุมแล้ว')
  })

  useMessageEffect(deletedMsg, () => {
    setEditingId(null)
    setDeletingId(null)
    toast.success('ลบผู้ควบคุมแล้ว')
  })

  useMessageEffect(errorMsg, (m) => {
    setCreating(false)
    setSavingId(null)
    setDeletingId(null)
    toast.error(errorText(m.code))
  })

  // region options, fetched once (national level excluded — dispatchers cover a
  // regional office or a province, never the whole country)
  useEffect(() => {
    if (regions !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/regions`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setRegions(data.filter((r) => r.level !== 'national'))
      } catch (e) {
        console.warn('[DispatchersTab] regions load failed:', e)
        if (!cancelled) setRegions([])
      }
    })()
    return () => { cancelled = true }
  }, [regions])

  const toggle = (id) => (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const togglePerm = (id) => setNewPerms(toggle(id))
  const toggleEditPerm = (id) => setEditPerms(toggle(id))

  const createDispatcher = (e) => {
    e.preventDefault()
    if (!newRegion) { toast.error(ERROR_MESSAGES.invalid_region); return }
    if (newPerms.length === 0) { toast.error('เลือกสิทธิ์อย่างน้อยหนึ่งรายการ'); return }
    setCreating(true)
    send({ type: 'create_dispatcher', username: newUsername, password: newPassword, name: newName, division: newDivision, region_id: newRegion, permissions: newPerms })
  }

  const startEdit = (d) => {
    setEditingId(d.user_id)
    setEditName(d.name ?? '')
    setEditDivision(d.division ?? '')
    setEditUsername(d.username ?? '')
    setEditPassword('')
    setEditRegion(d.region_id ?? '')
    setEditPerms(d.permissions ?? DISPATCHER_DEFAULT)
  }

  const saveEdit = (d) => {
    if (editPerms.length === 0) { toast.error('เลือกสิทธิ์อย่างน้อยหนึ่งรายการ'); return }
    setSavingId(d.user_id)
    const payload = { type: 'update_dispatcher', user_id: d.user_id, name: editName, username: editUsername, division: editDivision, permissions: editPerms }
    if (editRegion) payload.region_id = editRegion
    if (editPassword) payload.password = editPassword
    send(payload)
  }

  const removeDispatcher = (d) => {
    if (!window.confirm(`ลบผู้ควบคุม ${d.name ?? d.username}?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    setDeletingId(d.user_id)
    send({ type: 'delete_dispatcher', user_id: d.user_id })
  }

  return (
    <div>
      <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">ผู้ควบคุมประจำพื้นที่ (สร้าง แก้ไข และลบบัญชี)</p>

      {canManage && (<>
      <button
        type="button"
        onClick={() => setShowCreate((v) => !v)}
        aria-expanded={showCreate}
        className="w-full flex items-center justify-between gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-4 py-2.5 mb-2 text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-1.5">
          <PlusIcon className="w-4 h-4" />
          สร้างผู้ควบคุมใหม่
        </span>
        <ChevronDownIcon className={`w-4 h-4 transition-transform ${showCreate ? 'rotate-180' : ''}`} />
      </button>

      {showCreate && (
      <form onSubmit={createDispatcher} className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-2">
        <input
          type="text"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="ชื่อผู้ใช้"
          autoComplete="off"
          required
          className={INPUT_CLS}
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="ชื่อผู้ควบคุม"
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
        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-sm text-gray-600 px-1">สิทธิ์การใช้งาน</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {PERMISSION_OPTIONS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newPerms.includes(p.id)}
                  onChange={() => togglePerm(p.id)}
                  className="rounded border-gray-300 text-brand focus:ring-primary"
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
          autoComplete="new-password"
          required
          className={INPUT_CLS}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="bg-primary hover:bg-brand text-white rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {creating ? 'กำลังสร้าง…' : 'สร้างผู้ควบคุม'}
          </button>
        </div>
      </form>
      )}
      </>)}

      {dispatchers === null
        ? <p className="text-gray-500">กำลังโหลด…</p>
        : dispatchers.length === 0
          ? <p className="text-gray-500">ยังไม่มีผู้ควบคุม</p>
          : (
            <div className='overflow-y-auto max-h-80 no-scrollbar'>
              <ul className="space-y-2">
                {dispatchers.map((d) => (
                  <li key={d.user_id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                    {editingId === d.user_id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          placeholder="ชื่อผู้ใช้"
                          autoComplete="off"
                          className={INPUT_CLS}
                        />
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="ชื่อผู้ควบคุม"
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
                        <fieldset className="border border-gray-200 rounded-lg p-3">
                          <legend className="text-sm text-gray-600 px-1">สิทธิ์การใช้งาน</legend>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {PERMISSION_OPTIONS.map((p) => (
                              <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={editPerms.includes(p.id)}
                                  onChange={() => toggleEditPerm(p.id)}
                                  className="rounded border-gray-300 text-brand focus:ring-primary"
                                />
                                {p.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
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
                            className="text-sm text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-full px-3 py-1.5 disabled:opacity-50"
                          >
                            {deletingId === d.user_id ? 'กำลังลบ…' : 'ลบผู้ควบคุม'}
                          </button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
                            >
                              ยกเลิก
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(d)}
                              disabled={savingId === d.user_id}
                              className="bg-primary hover:bg-brand text-white rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
                            >
                              {savingId === d.user_id ? 'กำลังบันทึก…' : 'บันทึก'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{d.name ?? d.username}</p>
                          <p className="text-sm text-gray-500">{d.username}</p>
                          {d.division && <p className="text-sm text-gray-500">สังกัด: {d.division}</p>}
                          <p className="text-sm text-gray-500">{d.region_name_th} ({REGION_LEVEL_TH[d.region_level] ?? d.region_level})</p>
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => startEdit(d)}
                            className="text-sm text-brand hover:text-brand border border-orange-200 hover:border-orange-300 rounded-full px-3 py-1"
                          >
                            แก้ไข
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
      }
    </div>
  )
}
