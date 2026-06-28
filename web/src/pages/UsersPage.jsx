import { useEffect, useState, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../lib/useAuthStore'
import { toast } from '../lib/toastStore'
import { apiFetch, INPUT_CLS } from '../lib/shared'

const PAGE_SIZE = 20

// Superuser-only console for revoking account access. "Revoke" suspends the
// account and kills its live sessions (refresh tokens); "restore" re-enables it.
export default function UsersPage() {
  const user = useAuthStore((s) => s.user)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [divisions, setDivisions] = useState([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')      // '' | 'active' | 'suspended'
  const [division, setDivision] = useState('')  // '' = all
  const [sort, setSort] = useState('name')      // 'name' | 'sessions'
  const [order, setOrder] = useState('asc')     // 'asc' | 'desc'
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort, order })
      if (query.trim()) params.set('q', query.trim())
      if (status) params.set('status', status)
      if (division) params.set('division', division)
      const res = await apiFetch(`/users/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
      setDivisions(data.divisions ?? [])
    } catch (e) {
      console.warn('[UsersPage] load failed:', e)
      toast.error('โหลดรายชื่อผู้ใช้ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [query, page, status, division, sort, order])

  // debounce so typing/filtering doesn't fire a request per keystroke
  useEffect(() => {
    const id = setTimeout(load, 300)
    return () => clearTimeout(id)
  }, [load])

  if (!user?.is_superuser) return <Navigate to="/" replace />

  const action = async (u, kind) => {
    const verb = kind === 'revoke' ? 'ระงับสิทธิ์' : 'คืนสิทธิ์'
    if (!window.confirm(`${verb}บัญชี ${u.username}?`)) return
    setBusyId(u.id)
    try {
      const res = await apiFetch(`/users/${u.id}/${kind}`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.detail || `HTTP ${res.status}`)
      }
      toast.success(`${verb}แล้ว`)
      await load()
    } catch (e) {
      toast.error(`${verb}ไม่สำเร็จ: ${e.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0)

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-background">
      <div className="mx-auto flex h-full max-w-[1200px] flex-col gap-3 px-5 py-3 lg:px-8">

        <div className="flex flex-row gap-4 items-center">
          <h1 className="mt-2 pl-2 font-bold text-3xl text-primary">จัดการสิทธิ์ผู้ใช้</h1>
          <p className="font-medium text-md text-accent">ระงับหรือคืนสิทธิ์การเข้าถึงของบัญชีใดก็ได้</p>
        </div>

        <div className="flex-1 min-h-0 flex flex-col bg-foreground rounded-2xl p-4 shadow-md">

          <div className="mb-2 pb-2 border-b border-gray-300 flex flex-row items-center gap-3">
            <p className="font-medium text-accent text-lg whitespace-nowrap mr-auto">บัญชีทั้งหมด ({total})</p>

            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(0) }}
              title="กรองตามสถานะ"
              className={`${INPUT_CLS} w-32! text-accent`}
            >
              <option value="">ทุกสถานะ</option>
              <option value="active">ใช้งานได้</option>
              <option value="suspended">ถูกระงับ</option>
            </select>

            <select
              value={division}
              onChange={(e) => { setDivision(e.target.value); setPage(0) }}
              title="กรองตามสังกัด"
              className={`${INPUT_CLS} w-32! text-accent`}
            >
              <option value="">ทุกสังกัด</option>
              {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            <div className='flex flex-row gap-2 border border-gray-300 p-1.5 rounded-xl'>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(0) }}
              title="เรียงตาม"
              className={`${INPUT_CLS} w-32! text-accent`}
            >
              <option value="name">ชื่อผู้ใช้</option>
              <option value="sessions">จำนวนเซสชัน</option>
            </select>

            <button
              type="button"
              onClick={() => { setOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(0) }}
              title={order === 'asc' ? 'น้อยไปมาก' : 'มากไปน้อย'}
              className="px-3 py-2 rounded-xl border border-gray-300 text-accent hover:bg-gray-50"
            >
              {order === 'asc' ? '↑' : '↓'}
            </button>
            </div>

            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0) }}
              placeholder="ค้นหาชื่อผู้ใช้ หรือสังกัด"
              title="ค้นหาชื่อผู้ใช้ หรือสังกัด"
              autoComplete="off"
              className={`${INPUT_CLS} w-56 text-accent`}
            />

            <button
              type="button"
              onClick={load}
              disabled={loading}
              title="รีเฟรช"
              className="px-3 py-2 rounded-xl border border-gray-300 text-accent hover:bg-gray-50 disabled:opacity-50"
            >
              ⟳
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto minimal-scrollbar">
            {loading ? (
              <div className="h-full flex justify-center items-center"><p className="text-gray-400">กำลังโหลด…</p></div>
            ) : items.length === 0 ? (
              <div className="h-full flex justify-center items-center"><p className="text-gray-400">ไม่พบบัญชี</p></div>
            ) : (
              <table className="w-full table-fixed text-left border-collapse">
                <thead className="sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]">
                  <tr className="text-accent text-sm">
                    <th className="px-3 py-2 font-medium w-[32%]">ชื่อผู้ใช้</th>
                    <th className="px-3 py-2 font-medium w-[26%]">สังกัด</th>
                    <th className="px-3 py-2 font-medium w-[14%]">เซสชัน</th>
                    <th className="px-3 py-2 font-medium w-[14%]">สถานะ</th>
                    <th className="px-3 py-2 font-medium w-[14%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id} className="border-b border-background hover:bg-background/50">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <p title={u.username} className="text-md text-primary font-medium truncate">{u.username}</p>
                          {u.is_superuser && (
                            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">ผู้ดูแลระบบ</span>
                          )}
                        </div>
                      </td>
                      <td title={u.division || '—'} className="px-3 py-2.5 text-sm text-gray-500 font-light truncate">{u.division || '—'}</td>
                      <td className="px-3 py-2.5 text-sm text-gray-600">{u.active_sessions}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {u.is_active ? 'ใช้งานได้' : 'ถูกระงับ'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {u.is_superuser ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : u.is_active ? (
                          <button
                            type="button"
                            onClick={() => action(u, 'revoke')}
                            disabled={busyId === u.id}
                            className="text-sm text-red-600 hover:text-white border-2 border-red-300 hover:border-red-600 hover:bg-red-600 rounded-xl px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                          >
                            {busyId === u.id ? '…' : 'ระงับสิทธิ์'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => action(u, 'restore')}
                            disabled={busyId === u.id}
                            className="text-sm text-primary hover:text-brand border-2 border-flame hover:border-brand hover:bg-flame-light rounded-xl px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                          >
                            {busyId === u.id ? '…' : 'คืนสิทธิ์'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-300 text-sm text-gray-600">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                ก่อนหน้า
              </button>
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} จาก {total}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(p + 1, lastPage))}
                disabled={page >= lastPage}
                className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                ถัดไป
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
