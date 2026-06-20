import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import logo from '../assets/RFD_logo.svg'
import { API_URL } from "./management/shared";
import { useAuthStore } from "../functions/useAuthStore";

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  // superuser-only: the global mobile location-poll cadence (minutes). Read the
  // effective value on mount; saving applies it to every officer (floor 1 min).
  const [poll, setPoll] = useState('')
  const [pollSaved, setPollSaved] = useState(false)
  useEffect(() => {
    if (!user?.is_superuser) return
    fetch(`${API_URL}/officers/location-poll-interval`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPoll(String(d.minutes)))
      .catch(() => {})
  }, [user])

  const savePoll = async () => {
    const minutes = parseFloat(poll)
    if (!(minutes > 0)) return
    const r = await fetch(`${API_URL}/officers/location-poll-interval`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes }),
    })
    if (r.ok) {
      const d = await r.json()
      setPoll(String(d.minutes)) // server echoes the clamped effective value
      setPollSaved(true)
      setTimeout(() => setPollSaved(false), 2000)
    }
  }

  const links = [
    { name: 'แผนที่', path: '/' },
    { name: 'แดชบอร์ด', path: '/dashboard' },
    { name: 'การจัดการเจ้าหน้าที่', path: '/management' },
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/login', {replace: true})
  }

return (
    <nav className="relative z-20 flex justify-between items-center px-2 bg-white font-medium text-md shadow-md">
      <div className="flex items-center ml-4 gap-4 py-2">
        <img
          className="h-12 "
          src={logo}
          alt="Royal Forest Department logo"
        />
        <p className="text-lg font-semibold text-forest-600 font-title">
          ระบบรายงานและจัดการไฟป่า
        </p>
      </div>
      <span className="w-fit flex text-lg  justify-center font-light italic bg-primary-foreground border-2 border-gray-300 rounded-full px-4 py-1">
        {user.name ?? user.username}{user.division ? ` · ${user.division}` : ''}
      </span>
      {user?.is_superuser && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <label htmlFor="pollMins">ความถี่ตำแหน่ง (นาที)</label>
          <input
            id="pollMins"
            type="number"
            min="1"
            step="0.5"
            value={poll}
            onChange={(e) => setPoll(e.target.value)}
            className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={savePoll}
            className="bg-forest-500 text-white rounded-full px-3 py-1 hover:bg-forest-600"
          >
            {pollSaved ? 'บันทึกแล้ว' : 'บันทึก'}
          </button>
        </div>
      )}
      <ul className="flex h-full">
        {links.map((link) => (
          <li className="h-full " key={link.path}>
            <Link
              to={link.path}
              className={`h-full font-bold flex items-center px-3 hover:bg-forest-100 hover:text-forest-700 ${location.pathname === link.path ? 'bg-forest-100 text-forest-700' : ''}`}
            >
              {link.name}
            </Link>
          </li>
        ))}
        <button
              type="button"
              onClick={handleLogout}
              className="mx-2 bg-forest-500 text-white border border-forest-500 rounded-full px-4 my-2 hover:bg-forest-600"
            >
            ออกจากระบบ
        </button>
      </ul>
    </nav>
  )
}