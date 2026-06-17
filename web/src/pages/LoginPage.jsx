import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../functions/useAuthStore'
import { toast } from '../functions/toastStore'

export default function LoginPage() {

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      await login(identifier, password)
      toast.success('เข้าสู่ระบบสำเร็จ')
      setTimeout(() => navigate(from, { replace: true }), 800)
    } catch (err) {
      toast.error(err.message === 'login failed' ? 'เข้าสู่ระบบไม่สำเร็จ' : err.message)
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
              อีเมล
            </label>
            <input
              id="login-identifier"
              name="username"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
              autoComplete="off"
              placeholder="email@example.com"
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
            className="w-full bg-forest-500 hover:bg-forest-600 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 min-h-11"
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
    </div>
  )
}
