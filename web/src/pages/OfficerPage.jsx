import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSocketStore } from '../lib/stateStore'
import { useAuthStore, can } from '../lib/useAuthStore'
import { toast } from '../lib/toastStore'
import { useMessageEffect } from '../lib/useMessageEffect'
import { API_URL, INPUT_CLS, SELECT_CLS, errorText } from '../lib/shared'

// Officer management on a single page: verified officers in scope (inline edit /
// delete) above, plus the accounts awaiting verification and incoming
// region-change requests below — no tab switch.
export default function OfficerPage() {
  const user = useAuthStore((s) => s.user)
  const send = useSocketStore((s) => s.send)
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
  const [provinces, setProvinces] = useState(null) // null = not loaded yet
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
    setOfficers((prev) => prev.filter((o) => o.user_id !== m.user_id))
    setEditingId(null)
    setDeletingId(null)
    toast.success('ลบเจ้าหน้าที่แล้ว')
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
        console.warn('[OfficerPage] provinces load failed:', e)
        if (!cancelled) setProvinces([])
      }
    })()
    return () => { cancelled = true }
  }, [provinces])

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

  const decide = (requestId, action) => {
    setBusyId(requestId)
    send({ type: 'decide_region_request', request_id: requestId, action })
  }

  const loadingPending = pending === null
  const loadingRequests = requests === null
  return (
    <div className="py-2 h-screen flex flex-col gap-2 w-1/2 self-center overflow-y-hidden">
      <div className="bg-white border-0 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-brand font-title">เจ้าหน้าที่</h2>
      </div>
      <div className="flex-1 bg-white border-0 rounded-2xl p-6 mb-1 overflow-y-auto space-y-6">
        {/* Verified officers */}
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
                                className="bg-primary hover:bg-brand text-white rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
                              >
                                {savingId === o.user_id ? 'กำลังบันทึก…' : 'บันทึก'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{o.name ?? o.username}</p>
                            <p className="text-sm text-gray-500">{o.username}</p>
                            {o.division && <p className="text-sm text-gray-500">สังกัด: {o.division}</p>}
                            <p className="text-sm text-gray-500">{o.province_name_th}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {o.active ? 'ออนไลน์' : 'ออฟไลน์'}
                            </span>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => startEdit(o)}
                                className="text-sm text-brand hover:text-brand border border-orange-200 hover:border-orange-300 rounded-full px-3 py-1"
                              >
                                แก้ไข
                              </button>
                            )}
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

        {/* Accounts awaiting verification */}
        <div>
          <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

          {loadingPending && <p className="text-gray-500">กำลังโหลด…</p>}
          {!loadingPending && pending.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

          <div className='overflow-y-auto max-h-96 no-scrollbar'>
            <ul className="space-y-2">
              {(pending ?? []).map((o) => (
                <li key={o.user_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium">{o.name ?? o.username}</p>
                    <p className="text-sm text-gray-500">{o.username}</p>
                    {o.division && <p className="text-sm text-gray-500">สังกัด: {o.division}</p>}
                    <p className="text-sm text-gray-500">{o.province_name_th}</p>
                  </div>
                  {canVerify && (
                    <button
                      type="button"
                      onClick={() => verify(o.user_id)}
                      disabled={busyId === o.user_id}
                      className="bg-primary hover:bg-brand text-white rounded-full px-4 py-1.5 disabled:opacity-50"
                    >
                      {busyId === o.user_id ? 'กำลังยืนยัน…' : 'ยืนยัน'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Incoming region-change requests */}
        {canViewReq && (
        <div>
          <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">คำขอย้ายพื้นที่ (เข้ามายังเขตของคุณ)</p>

          {loadingRequests && <p className="text-gray-500">กำลังโหลด…</p>}
          {!loadingRequests && requests.length === 0 && <p className="text-gray-500">ไม่มีคำขอย้ายพื้นที่</p>}

          <div className='overflow-y-auto max-h-96 no-scrollbar'>
            <ul className="space-y-2">
              {(requests ?? []).map((r) => (
                <li key={r.request_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium">{r.officer_name ?? r.username}</p>
                    <p className="text-sm text-gray-500">{r.username}</p>
                    <p className="text-sm text-gray-500">{r.current_province} → {r.requested_province}</p>
                  </div>
                  {canDecide && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => decide(r.request_id, 'approve')}
                      disabled={busyId === r.request_id}
                      className="bg-primary hover:bg-brand text-white rounded-full px-4 py-1.5 disabled:opacity-50"
                    >
                      อนุมัติ
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(r.request_id, 'reject')}
                      disabled={busyId === r.request_id}
                      className="border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-full px-4 py-1.5 disabled:opacity-50"
                    >
                      ปฏิเสธ
                    </button>
                  </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
