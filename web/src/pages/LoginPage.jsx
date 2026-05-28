import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Toast from '../components/toast'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({ message: '', type: 'success' })

  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/map'

  const showToast = (message, type = 'success') => setToast({ message, type })
  const closeToast = () => setToast({ message: '', type: 'success' })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    const body = new URLSearchParams({ username: identifier, password })

    try {
      const res = await fetch(`${API_URL}/auth/cookie/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.detail || 'login failed')
      }
      showToast('เข้าสู่ระบบสำเร็จ')
      setTimeout(() => navigate(from, { replace: true }), 800)
    } catch (err) {
      showToast(err.message === 'login failed'
        ? 'เข้าสู่ระบบไม่สำเร็จ'
        : err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-forest-50 to-forest-100 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-forest-500 rounded-full mb-4">
            <img
              src="https://www.forest.go.th/wp-content/uploads/2023/02/color-png.png"
              alt="Royal Forest Department logo"
              className="w-20 h-20"
            />
          </div>
          <h1 className="text-2xl font-bold text-forest-700">ระบบจัดการไฟป่า</h1>
          <p className="text-gray-600 mt-1">กรมป่าไม้</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-identifier" className="block text-sm font-medium text-gray-700 mb-1">
              ชื่อผู้ใช้ หรือ อีเมล
            </label>
            <input
              id="login-identifier"
              name="username"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
              autocomplete="off"
              placeholder="username หรือ email@example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-forest-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
              รหัสผ่าน
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-forest-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading || undefined}
            className="w-full bg-forest-500 hover:bg-forest-600 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 min-h-[44px]"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500">
            สำหรับเจ้าหน้าที่กรมป่าไม้
          </p>
        </div>
      </div>
      <Toast message={toast.message} type={toast.type} onClose={closeToast} />
    </div>
  )
}
