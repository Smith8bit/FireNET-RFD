import { useEffect, useState } from 'react'
import { useSocketStore } from '../functions/stateStore'

export default function ManagementPage() {
  const send = useSocketStore((s) => s.send)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [officers, setOfficers] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    send({ type: 'list_pending_officers' })
  }, [send])

  useEffect(() => {
    if (!pendingMsg) return
    setOfficers(pendingMsg.officers ?? [])
    setError(null)
  }, [pendingMsg])

  useEffect(() => {
    if (!verifiedMsg) return
    setOfficers((prev) => prev ? prev.filter((o) => o.user_id !== verifiedMsg.user_id) : prev)
    setBusyId(null)
  }, [verifiedMsg])

  useEffect(() => {
    if (!errorMsg) return
    setError('เกิดข้อผิดพลาด: ' + (errorMsg.code ?? 'unknown'))
    setBusyId(null)
  }, [errorMsg])

  const verify = (id) => {
    setBusyId(id)
    setError(null)
    send({ type: 'verify_officer', user_id: id })
  }

  const loading = officers === null

  return (
    <div className="p-6 overflow-auto">
      <h1 className="text-2xl font-bold text-forest-700 mb-1">จัดการเจ้าหน้าที่ภาคสนาม</h1>
      <p className="text-gray-600 mb-4">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

      {loading && <p className="text-gray-500">กำลังโหลด…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && officers.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

      <ul className="space-y-2 max-w-2xl">
        {(officers ?? []).map((o) => (
          <li key={o.user_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div>
              <p className="font-medium">{o.email}</p>
              <p className="text-sm text-gray-500">{o.province_name_th} · {o.province_path}</p>
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
  )
}
