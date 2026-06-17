import { useEffect, useState } from 'react'
import { useSocketStore } from '../../functions/stateStore'
import { toast } from '../../functions/toastStore'
import { useMessageEffect } from '../../functions/useMessageEffect'
import { errorText } from './shared'

// Accounts awaiting verification within the admin's scope. `onCount` reports the
// current pending total up to the page so the tab badge stays in sync.
export default function PendingTab({ onCount }) {
  const send = useSocketStore((s) => s.send)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [officers, setOfficers] = useState(null) // null = loading
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { send({ type: 'list_pending_officers' }) }, [send])

  useEffect(() => {
    if (!pendingMsg) return
    setOfficers(pendingMsg.officers ?? [])
  }, [pendingMsg])

  useMessageEffect(verifiedMsg, (m) => {
    setOfficers((prev) => prev ? prev.filter((o) => o.user_id !== m.user_id) : prev)
    setBusyId(null)
    toast.success('ยืนยันเจ้าหน้าที่สำเร็จ')
  })

  useMessageEffect(errorMsg, (m) => {
    setBusyId(null)
    toast.error(errorText(m.code))
  })

  useEffect(() => { onCount?.(officers?.length ?? null) }, [officers, onCount])

  const verify = (id) => {
    setBusyId(id)
    send({ type: 'verify_officer', user_id: id })
  }

  const loading = officers === null
  return (
    <div>
      <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300 font-title font-medium">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

      {loading && <p className="text-gray-500">กำลังโหลด…</p>}
      {!loading && officers.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

      <div className='overflow-y-auto max-h-96 no-scrollbar'>
        <ul className="space-y-2">
          {(officers ?? []).map((o) => (
            <li key={o.user_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
              <div>
                <p className="font-medium">{o.name ?? o.email}</p>
                <p className="text-sm text-gray-500">{o.email}</p>
                <p className="text-sm text-gray-500">{o.province_name_th}</p>
              </div>
              <button
                type="button"
                onClick={() => verify(o.user_id)}
                disabled={busyId === o.user_id}
                className="bg-forest-500 hover:bg-forest-600 text-white rounded-full px-4 py-1.5 disabled:opacity-50"
              >
                {busyId === o.user_id ? 'กำลังยืนยัน…' : 'ยืนยัน'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
