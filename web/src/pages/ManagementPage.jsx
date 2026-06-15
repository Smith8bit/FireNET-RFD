import { useEffect, useState } from 'react'
import AuditTrail from '../components/auditTrail'
import { useSocketStore } from '../functions/stateStore'
import { useAuthStore } from '../functions/useAuthStore'

const API_URL = import.meta.env.VITE_API_URL ?? ''

export default function ManagementPage() {
  const send = useSocketStore((s) => s.send)
  const user = useAuthStore((s) => s.user)
  const pendingMsg = useSocketStore((s) => s.byType?.pending_officers)
  const verifiedMsg = useSocketStore((s) => s.byType?.officer_verified)
  const officersMsg = useSocketStore((s) => s.byType?.officers_in_region)
  const updatedMsg = useSocketStore((s) => s.byType?.officer_updated)
  const errorMsg = useSocketStore((s) => s.byType?.error)

  const [selectedTab, setSelectedTab] = useState("Pending")
  const [officers, setOfficers] = useState(null) // null = loading
  const [regionOfficers, setRegionOfficers] = useState([])
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [provinces, setProvinces] = useState(null) // null = not loaded yet
  const [editingId, setEditingId] = useState(null) // user_id being edited
  const [editName, setEditName] = useState('')
  const [editProvince, setEditProvince] = useState('') // Region.code
  const [savingId, setSavingId] = useState(null)

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
    if (!updatedMsg) return
    console.log('[ManagementPage] officer_updated received:', updatedMsg.user_id)
    setEditingId(null)
    setSavingId(null)
  }, [updatedMsg])

  useEffect(() => {
    if (!errorMsg) return
    console.warn('[ManagementPage] error received:', errorMsg)
    setError('เกิดข้อผิดพลาด: ' + (errorMsg.code ?? 'unknown'))
    setBusyId(null)
    setSavingId(null)
  }, [errorMsg])

  // provinces for the edit form, loaded once when the Officers tab is opened
  useEffect(() => {
    if (selectedTab !== 'Officers' || provinces !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/regions/provinces`, { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setProvinces(data)
      } catch (e) {
        console.warn('[ManagementPage] provinces load failed:', e)
        if (!cancelled) setProvinces([])
      }
    })()
    return () => { cancelled = true }
  }, [selectedTab, provinces])

  const verify = (id) => {
    console.log('[ManagementPage] verifying officer:', id)
    setBusyId(id)
    setError(null)
    send({ type: 'verify_officer', user_id: id })
  }

  const startEdit = (o) => {
    setEditingId(o.user_id)
    setEditName(o.name ?? '')
    setEditProvince((provinces ?? []).find((p) => p.path === o.province_path)?.code ?? '')
    setError(null)
  }

  const saveEdit = (o) => {
    console.log('[ManagementPage] updating officer:', o.user_id)
    setSavingId(o.user_id)
    setError(null)
    const payload = { type: 'update_officer', user_id: o.user_id, name: editName }
    if (editProvince) payload.province_code = editProvince
    send(payload)
  }

  const loading = officers === null

  // the audit endpoint is superuser-only (regional scoping deferred)
  const tabs = user?.is_superuser ? ['Pending', 'Officers', 'Audit'] : ['Pending', 'Officers']

  return (
    <div className="py-2 h-screen flex flex-col gap-2 w-1/2 self-center overflow-y-hidden">
      <div className='bg-white border-0 rounded-2xl p-6'>
        <h2 className="text-lg font-semibold text-forest-700 mb-3">การจัดการเจ้าหน้าที่ภาคสนาม</h2>
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
              {tab === 'Pending' ? `รอยืนยัน${officers ? ` (${officers.length})` : ''}` : tab === 'Officers' ? 'เจ้าหน้าที่' : 'บันทึกเหตุการณ์'}
            </button>
          ))}
        </div>
      </div >
      <div className='flex-1 bg-white border-0 rounded-2xl p-6 mb-1'>
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
        )}

        {selectedTab === 'Officers' && (
          <div>
            <p className="text-gray-600 mb-2 pb-2 border-b border-gray-300">เจ้าหน้าที่ที่ได้รับการยืนยันแล้วในเขตของคุณ</p>

            {error && <p className="text-red-600 mb-2">{error}</p>}
            {regionOfficers.length === 0
              ? <p className="text-gray-500">ยังไม่มีเจ้าหน้าที่ที่ได้รับการยืนยัน</p>
              : (
                <div className='overflow-y-auto max-h-96 no-scrollbar'>
                  <ul className="space-y-2">
                    {regionOfficers.map((o) => (
                      <li key={o.field_officer_id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                        {editingId === o.user_id ? (
                          <div className="space-y-2">
                            <p className="text-sm text-gray-500">{o.email}</p>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="ชื่อเจ้าหน้าที่"
                              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                            />
                            <select
                              value={editProvince}
                              onChange={(e) => setEditProvince(e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
                            >
                              <option value="">— จังหวัดเดิม —</option>
                              {(provinces ?? []).map((p) => (
                                <option key={p.code} value={p.code}>{p.name_th}</option>
                              ))}
                            </select>
                            <div className="flex justify-end gap-2">
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
        )}

        {selectedTab === 'Audit' && <AuditTrail />}
      </div>
    </div>
  )
}
