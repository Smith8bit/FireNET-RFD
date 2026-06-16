import { useEffect, useState } from 'react'
import { useSocketStore } from '../../functions/stateStore'
import { toast } from '../../functions/toastStore'
import { useMessageEffect } from '../../functions/useMessageEffect'
import { API_URL, INPUT_CLS, SELECT_CLS, errorText } from './shared'

// Verified field officers within the admin's scope, with inline edit (name,
// province, login email/password) and delete.
export default function OfficersTab() {
  const send = useSocketStore((s) => s.send)
  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const updatedMsg = useSocketStore((s) => s.byType?.officer_updated)
  const deletedMsg = useSocketStore((s) => s.byType?.officer_deleted)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [officers, setOfficers] = useState([])
  const [provinces, setProvinces] = useState(null) // null = not loaded yet
  const [editingId, setEditingId] = useState(null) // user_id being edited
  const [editName, setEditName] = useState('')
  const [editProvince, setEditProvince] = useState('') // Region.code
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('') // blank = keep current
  const [savingId, setSavingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { send({ type: 'list_officers' }) }, [send])

  useEffect(() => {
    if (!officersMsg) return
    setOfficers(officersMsg.officers ?? [])
  }, [officersMsg])

  useMessageEffect(updatedMsg, () => {
    setEditingId(null)
    setSavingId(null)
    toast.success('บันทึกข้อมูลเจ้าหน้าที่แล้ว')
  })

  useMessageEffect(deletedMsg, (m) => {
    setOfficers((prev) => prev.filter((o) => o.user_id !== m.user_id))
    setEditingId(null)
    setDeletingId(null)
    toast.success('ลบเจ้าหน้าที่แล้ว')
  })

  useMessageEffect(errorMsg, (m) => {
    setSavingId(null)
    setDeletingId(null)
    toast.error(errorText(m.code))
  })

  // provinces for the edit form's reassignment dropdown, loaded once
  useEffect(() => {
    if (provinces !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/regions/provinces`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setProvinces(data)
      } catch (e) {
        console.warn('[OfficersTab] provinces load failed:', e)
        if (!cancelled) setProvinces([])
      }
    })()
    return () => { cancelled = true }
  }, [provinces])

  const startEdit = (o) => {
    setEditingId(o.user_id)
    setEditName(o.name ?? '')
    setEditProvince((provinces ?? []).find((p) => p.path === o.province_path)?.code ?? '')
    setEditEmail(o.email ?? '')
    setEditPassword('')
  }

  const saveEdit = (o) => {
    setSavingId(o.user_id)
    const payload = { type: 'update_officer', user_id: o.user_id, name: editName, email: editEmail }
    if (editProvince) payload.province_code = editProvince
    if (editPassword) payload.password = editPassword
    send(payload)
  }

  const removeOfficer = (o) => {
    if (!window.confirm(`ลบเจ้าหน้าที่ ${o.name ?? o.email}?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return
    setDeletingId(o.user_id)
    send({ type: 'delete_officer', user_id: o.user_id })
  }

  return (
    <div>
      <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">เจ้าหน้าที่ที่ได้รับการยืนยันแล้วในเขตของคุณ</p>

      {officers.length === 0
        ? <p className="text-gray-500">ยังไม่มีเจ้าหน้าที่ที่ได้รับการยืนยัน</p>
        : (
          <div className='overflow-y-auto max-h-96 no-scrollbar'>
            <ul className="space-y-2">
              {officers.map((o) => (
                <li key={o.field_officer_id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                  {editingId === o.user_id ? (
                    <div className="space-y-2">
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="อีเมล"
                        autoComplete="off"
                        className={INPUT_CLS}
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="ชื่อเจ้าหน้าที่"
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
                          className="text-sm text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-full px-3 py-1.5 disabled:opacity-50"
                        >
                          {deletingId === o.user_id ? 'กำลังลบ…' : 'ลบเจ้าหน้าที่'}
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
                            onClick={() => saveEdit(o)}
                            disabled={savingId === o.user_id}
                            className="bg-forest-500 hover:bg-forest-600 text-white rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
                          >
                            {savingId === o.user_id ? 'กำลังบันทึก…' : 'บันทึก'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{o.name ?? o.email}</p>
                        <p className="text-sm text-gray-500">{o.email}</p>
                        <p className="text-sm text-gray-500">{o.province_name_th}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {o.active ? 'ออนไลน์' : 'ออฟไลน์'}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(o)}
                          className="text-sm text-forest-700 hover:text-forest-600 border border-forest-200 hover:border-forest-300 rounded-full px-3 py-1"
                        >
                          แก้ไข
                        </button>
                      </div>
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
