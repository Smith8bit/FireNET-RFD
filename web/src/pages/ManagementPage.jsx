import { useCallback, useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? ''
const api = (path, init = {}) => fetch(`${API_URL}${path}`, { credentials: 'include', ...init })

export default function ManagementPage() {
  const [officers, setOfficers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api('/officers/pending')
      if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ')
      setOfficers(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const verify = async (id) => {
    setBusyId(id); setError(null)
    try {
      const res = await api(`/officers/${id}/verify`, { method: 'POST' })
      if (!res.ok) throw new Error('ยืนยันไม่สำเร็จ')
      setOfficers((prev) => prev.filter((o) => o.user_id !== id))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 overflow-auto">
      <h1 className="text-2xl font-bold text-forest-700 mb-1">จัดการเจ้าหน้าที่ภาคสนาม</h1>
      <p className="text-gray-600 mb-4">บัญชีที่รอการยืนยัน (เฉพาะในเขตพื้นที่ของคุณ)</p>

      {loading && <p className="text-gray-500">กำลังโหลด…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && officers.length === 0 && <p className="text-gray-500">ไม่มีบัญชีที่รอการยืนยัน</p>}

      <ul className="space-y-2 max-w-2xl">
        {officers.map((o) => (
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