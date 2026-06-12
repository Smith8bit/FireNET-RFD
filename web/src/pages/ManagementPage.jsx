import { useEffect, useState } from 'react'
import { useSocketStore } from '../functions/stateStore'

export default function ManagementPage() {
  const send = useSocketStore((s) => s.send)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [selectedTab, setSelectedTab] = useState("Pending")
  const [officers, setOfficers] = useState(null) // null = loading
  const [regionOfficers, setRegionOfficers] = useState([])
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    console.log('[ManagementPage] mounted — requesting pending officers and officers in region')
    send({ type: 'list_pending_officers' })
    send({ type: 'list_officers' })
  }, [send])

  useEffect(() => {
    if (!pendingMsg) return
    console.log('[ManagementPage] pending_officers received:', pendingMsg.officers)
    setOfficers(pendingMsg.officers ?? [])
    setError(null)
  }, [pendingMsg])

  useEffect(() => {
    if (!verifiedMsg) return
    console.log('[ManagementPage] officer_verified received:', verifiedMsg.user_id)
    setOfficers((prev) => prev ? prev.filter((o) => o.user_id !== verifiedMsg.user_id) : prev)
    setBusyId(null)
  }, [verifiedMsg])

  useEffect(() => {
    if (!officersMsg) return
    console.log('[ManagementPage] officers_in_region received:', officersMsg.officers)
    setRegionOfficers(officersMsg.officers ?? [])
  }, [officersMsg])

  useEffect(() => {
    if (!errorMsg) return
    console.warn('[ManagementPage] error received:', errorMsg)
    setError('เกิดข้อผิดพลาด: ' + (errorMsg.code ?? 'unknown'))
    setBusyId(null)
  }, [errorMsg])

  const verify = (id) => {
    console.log('[ManagementPage] verifying officer:', id)
    setBusyId(id)
    setError(null)
    send({ type: 'verify_officer', user_id: id })
  }

  const loading = officers === null

  const tabs = ['Pending', 'Officers', 'Audit']

  return (
    <div className="py-2 h-screen flex flex-col gap-2 w-1/2 self-center overflow-y-hidden">
      <div className='bg-white border-0 rounded-2xl p-6'>
        <h2 className="text-lg font-semibold text-forest-700 mb-3">จัดการเจ้าหน้าที่ภาคสนาม</h2>
        <div className="flex gap-2 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                selectedTab === tab
                  ? 'border-forest-500 text-forest-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'Pending' ? `รอยืนยัน${officers ? ` (${officers.length})` : ''}` : tab === 'Officers' ? 'เจ้าหน้าที่' : 'ประวัติ'}
            </button>
          ))}
        </div>
      </div >
      <div className='flex-1 bg-white border-0 rounded-2xl p-6'>
        {selectedTab === 'Pending' && (
          <div>
            <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

            {loading && <p className="text-gray-500">กำลังโหลด…</p>}
            {error && <p className="text-red-600">{error}</p>}
            {!loading && officers.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

            <div className='overflow-y-auto max-h-96 no-scrollbar'>
              <ul className="space-y-2">
                {(officers ?? []).map((o) => (
                  <li key={o.user_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                    <div>
                      <p className="font-medium">{o.name ?? o.email}</p>
                      <p className="text-sm text-gray-500">{o.email}</p>
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
          </div>
        )}

        {selectedTab === 'Officers' && (
          <div>
            <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300">เจ้าหน้าที่ที่ได้รับการยืนยันแล้วในเขตของคุณ</p>

            {regionOfficers.length === 0
              ? <p className="text-gray-500">ยังไม่มีเจ้าหน้าที่ที่ได้รับการยืนยัน</p>
              : (
                <div className='overflow-y-auto max-h-96 no-scrollbar'>
                  <ul className="space-y-2">
                    {regionOfficers.map((o) => (
                      <li key={o.field_officer_id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                        <div>
                          <p className="font-medium">{o.name ?? o.email}</p>
                          <p className="text-sm text-gray-500">{o.email}</p>
                          <p className="text-sm text-gray-500">{o.province_name_th} · {o.province_path}</p>
                        </div>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${o.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {o.active ? 'ปฏิบัติงาน' : 'ว่าง'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            }
          </div>
        )}

        {selectedTab === 'Audit' && (
          <div>
            <p className="text-gray-500">ประวัติการยืนยันเจ้าหน้าที่ (ยังไม่พร้อมใช้งาน)</p>
          </div>
        )}
      </div>
    </div>
  )
}
