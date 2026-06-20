import { useEffect, useState } from 'react'
import { useSocketStore } from '../../functions/stateStore'
import { useAuthStore, can } from '../../functions/useAuthStore'
import { toast } from '../../functions/toastStore'
import { useMessageEffect } from '../../functions/useMessageEffect'
import { errorText } from './shared'

// Accounts awaiting verification + officer region-change requests, both within the
// admin's scope. `onCount` reports the combined pending total so the tab badge stays
// in sync.
export default function PendingTab({ onCount }) {
  const send = useSocketStore((s) => s.send)
  const user = useAuthStore((s) => s.user)
  const canVerify = can(user, 'officer.verify')
  const canViewReq = can(user, 'region_requests.view')
  const canDecide = can(user, 'region_request.decide')
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const requestsMsg = useSocketStore((s) => s.byType?.region_change_requests)
  const decidedMsg = useSocketStore((s) => s.byType?.region_request_decided)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [officers, setOfficers] = useState(null) // null = loading
  const [requests, setRequests] = useState(null) // region-change requests
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    send({ type: 'list_pending_officers' })
    if (canViewReq) send({ type: 'list_region_requests' })
  }, [send, canViewReq])

  useEffect(() => {
    if (!pendingMsg) return
    setOfficers(pendingMsg.officers ?? [])
  }, [pendingMsg])

  useEffect(() => {
    if (!requestsMsg) return
    setRequests(requestsMsg.requests ?? [])
  }, [requestsMsg])

  useMessageEffect(verifiedMsg, (m) => {
    setOfficers((prev) => prev ? prev.filter((o) => o.user_id !== m.user_id) : prev)
    setBusyId(null)
    toast.success('ยืนยันเจ้าหน้าที่สำเร็จ')
  })

  useMessageEffect(decidedMsg, (m) => {
    setRequests((prev) => prev ? prev.filter((r) => r.request_id !== m.request_id) : prev)
    setBusyId(null)
    toast.success(m.status === 'approved' ? 'อนุมัติการย้ายพื้นที่แล้ว' : 'ปฏิเสธคำขอแล้ว')
  })

  useMessageEffect(errorMsg, (m) => {
    setBusyId(null)
    toast.error(errorText(m.code))
  })

  useEffect(() => {
    const o = officers?.length
    const r = requests?.length
    onCount?.(o == null && r == null ? null : (o ?? 0) + (r ?? 0))
  }, [officers, requests, onCount])

  const verify = (id) => {
    setBusyId(id)
    send({ type: 'verify_officer', user_id: id })
  }

  const decide = (requestId, action) => {
    setBusyId(requestId)
    send({ type: 'decide_region_request', request_id: requestId, action })
  }

  const loadingOfficers = officers === null
  const loadingRequests = requests === null
  return (
    <div className="space-y-6">
      <div>
        <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

        {loadingOfficers && <p className="text-gray-500">กำลังโหลด…</p>}
        {!loadingOfficers && officers.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

        <div className='overflow-y-auto max-h-96 no-scrollbar'>
          <ul className="space-y-2">
            {(officers ?? []).map((o) => (
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
  )
}
