import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../lib/useAuthStore'
import { toast } from '../lib/toastStore'
import forestPlaceholder from '../assets/forest_placeholder.jpg'
import appIcon from '../assets/icon.png'

// Map backend/auth error codes to Thai messages. Anything unrecognized falls
// back to a generic message so raw codes (e.g. LOGIN_USER_NOT_VERIFIED) or
// network errors like "Failed to fetch" never leak to the user.
const LOGIN_ERRORS = {
  LOGIN_BAD_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
}

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

    const username = identifier.trim()
    if (!username || !password) {
      toast.error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }
    if (username.length < 3) {
      toast.error('ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร')
      return
    }

    setLoading(true)

    try {
      await login(username, password)
      toast.success('เข้าสู่ระบบสำเร็จ')
      setTimeout(() => navigate(from, { replace: true }), 800)
    } catch (err) {
      toast.error(LOGIN_ERRORS[err.message] || err.message || 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    // ver.Real
    <div className="min-h-screen bg-background flex justify-start overflow-hidden">
      <div id='login' className="relative z-10  bg-foreground w-full max-w-md flex flex-col justify-center py-8 px-10 shadow-2xl">
        <div className='flex flex-col'>
          <div className="w-full flex items-center gap-4 mb-8">
            <img
              src={appIcon}
              alt="FireNET"
              className="w-24 h-24 shrink-0 rounded-[28%] object-cover"
            />
            <div>
              <h1 className="text-4xl font-bold text-primary">FireNET</h1>
              <h1 className="text-3xl font-medium text-gray-500">ระบบจัดการไฟป่า</h1>
              <p className="text-lg text-gray-400 font-medium font-head">สำหรับผู้ดูแล</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4" noValidate>
            <div>
              <label htmlFor="login-identifier" className="block text-base font-title text-gray-700 mb-1.5">
                ชื่อผู้ใช้
              </label>
              <input
                id="login-identifier"
                name="username"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                minLength={3}
                autoFocus
                autoComplete="off"
                placeholder="ไม่ต่ำกว่า3ตัวอักษร"
                className="w-full px-4 py-2 text-base font-title text-gray-700 border border-gray-300 rounded-lg focus:ring-2 focus:ring-secondary outline-none"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-base font-title text-gray-700 mb-1.5">
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
                className="w-full px-4 py-2 text-base font-title text-gray-700 border border-gray-300 rounded-lg focus:ring-2 focus:ring-secondary outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading || undefined}
              className="w-full bg-primary hover:bg-brand text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 min-h-11"
            >
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <div className="w-full mt-6 pt-2 border-t border-gray-300 text-center">
            <p className="text-md text-gray-500">
              สำนักป้องกันรักษาป่าและควบคุมไฟป่า
            </p>
          </div>
        </div>
      </div>
      <div className='flex-1 overflow-hidden'>
        <img
          src={forestPlaceholder}
          alt="ป่าไม้"
          className="w-full h-full object-fill"
        />
      </div>
    </div>

    // Testing: Dark mode
    // <div className="min-h-screen bg-black flex justify-start overflow-hidden">
    //   <div id='login' className="relative z-10  bg-accent w-full max-w-md flex flex-col justify-center py-8 px-10 shadow-2xl">
    //     <div className='flex flex-col'>
    //       <div className="w-full flex items-center gap-4 mb-8">
    //         <div
    //           role="img"
    //           aria-label="Logo placeholder"
    //           className="inline-flex items-center justify-center w-24 h-24 shrink-0 bg-primary rounded-[28%] text-white text-2xl font-bold"
    //         >
    //           ? 
    //         </div>
    //         <div>
    //           <h1 className="text-4xl font-bold text-primary">FireNET</h1>
    //           <h1 className="text-3xl font-medium text-white">ระบบจัดการไฟป่า</h1>
    //           <p className="text-lg text-gray-300 font-medium font-head">สำหรับผู้ดูแล</p>
    //         </div>
    //       </div>

    //       <form onSubmit={handleSubmit} className="w-full space-y-4" noValidate>
    //         <div>
    //           <label htmlFor="login-identifier" className="block text-base font-title text-white mb-1.5">
    //             ชื่อผู้ใช้
    //           </label>
    //           <input
    //             id="login-identifier"
    //             name="username"
    //             type="text"
    //             value={identifier}
    //             onChange={(e) => setIdentifier(e.target.value)}
    //             required
    //             autoFocus
    //             autoComplete="off"
    //             placeholder="ไม่ต่ำกว่า3ตัวอักษร"
    //             className="w-full px-4 py-2 text-base font-title text-gray-700 bg-foreground border rounded-lg focus:ring-2 focus:ring-secondary outline-none"
    //           />
    //         </div>

    //         <div>
    //           <label htmlFor="login-password" className="block text-base font-title text-white mb-1.5">
    //             รหัสผ่าน
    //           </label>
    //           <input
    //             id="login-password"
    //             name="password"
    //             type="password"
    //             value={password}
    //             onChange={(e) => setPassword(e.target.value)}
    //             required
    //             autoComplete="current-password"
    //             placeholder="••••••••"
    //             className="w-full px-4 py-2 text-base font-title text-gray-700 bg-foreground border rounded-lg focus:ring-2 focus:ring-secondary outline-none"              />
    //         </div>

    //         <button
    //           type="submit"
    //           disabled={loading}
    //           aria-busy={loading || undefined}
    //           className="w-full bg-primary hover:bg-brand text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 min-h-11"
    //         >
    //           {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
    //         </button>
    //       </form>

    //       <div className="w-full mt-6 pt-2 border-t border-gray-300 text-center">
    //         <p className="text-md text-white">
    //           สำนักป้องกันรักษาป่าและควบคุมไฟป่า
    //         </p>
    //       </div>
    //     </div>
    //   </div>
    //   <div className='flex-1 overflow-hidden'>
    //     <img
    //       src={forestPlaceholder}
    //       alt="ป่าไม้"
    //       className="w-full h-full object-fill"
    //     />
    //   </div>
    // </div>
  )
}
