import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  MapIcon,
  Squares2X2Icon as DashboardIcon,
  UsersIcon,
  ShieldCheckIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  NoSymbolIcon,
  ViewColumnsIcon as SidebarToggleIcon,
  ArrowRightOnRectangleIcon as LogoutIcon,
} from "@heroicons/react/24/outline";
import { apiFetch } from "../lib/shared";
import appIcon from "../assets/icon.png";
import { useAuthStore, can } from "../lib/useAuthStore";

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1'
  )
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  const [poll, setPoll] = useState('')
  const [pollSaved, setPollSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!user?.is_superuser) return
    apiFetch('/officers/location-poll-interval')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPoll(String(d.minutes)))
      .catch(() => {})
  }, [user])

  const savePoll = async () => {
    const minutes = parseFloat(poll)
    if (!(minutes > 0) || saving) return
    setSaving(true)
    setTimeout(() => setSaving(false), 2000)
    const r = await apiFetch('/officers/location-poll-interval', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes }),
    })
    if (r.ok) {
      const d = await r.json()
      setPoll(String(d.minutes))
      setPollSaved(true)
      setTimeout(() => setPollSaved(false), 2000)
    }
  }

  const links = [
    { name: 'แผนที่', path: '/', icon: MapIcon },
    { name: 'แดชบอร์ด', path: '/dashboard', icon: DashboardIcon },
    can(user, 'officers.view') && { name: 'เจ้าหน้าที่', path: '/officers', icon: UsersIcon },
    can(user, 'dispatchers.view') && { name: 'ผู้ดูแล', path: '/dispatchers', icon: ShieldCheckIcon },
    can(user, 'fires.history') && { name: 'ประวัติการดับไฟ', path: '/history', icon: ClockIcon },
    user?.is_superuser && { name: 'บันทึกเหตุการณ์', path: '/audit', icon: ClipboardDocumentListIcon },
    user?.is_superuser && { name: 'จัดการสิทธิ์ผู้ใช้', path: '/access', icon: NoSymbolIcon },
  ].filter(Boolean)

  const handleLogout = async () => {
    await logout()
    navigate('/login', {replace: true})
  }

  const initial = (user.name ?? user.username).charAt(0).toUpperCase()
  const fullLabel = `${user.name ?? user.username}${user.division ? ` · ${user.division}` : ''}`

  return (
    <nav
      aria-label="Sidebar"
      className={`relative z-20 pt-3 flex flex-col h-screen shrink-0 overflow-x-hidden whitespace-nowrap border-r border-background/50 bg-foreground shadow-sm lg:shadow-none transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${collapsed ? 'w-16' : 'w-56'}`}
    >
      <div className="relative flex h-14 items-center px-3.5 border-b border-background">
        <div
          className={`absolute flex items-center transition-opacity duration-250 ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <img
            src={appIcon}
            alt="FireNET"
            className="h-10 w-10 shrink-0 rounded-[28%] object-cover"
          />
          <div className="flex-col ml-2">
            <p className=" text-xl font-semibold tracking-tight text-primary leading-none">
              FireNET
            </p>
            <p className="mt-1 text-sm font-normal tracking-tight text-accent leading-none">
              ระบบจัดการไฟป่า
            </p>
            </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
          className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:bg-black/5 hover:text-gray-800 transition-colors ${collapsed ? 'mx-auto' : 'ml-auto'}`}
        >
          <SidebarToggleIcon className="w-4.5 h-4.5" />
        </button>
      </div>

      <div className="px-4 py-3 border-background border-b">
        <div
          className="flex items-center gap-3 rounded-full "
          title={fullLabel}
        >
          <div className="flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm font-semibold">
            {initial}
          </div>
          <div className="flex-col my-auto gap-2">
            <div className={`truncate text-md text-accent transition-opacity duration-300 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
              {user.name}
            </div>
            <div className={`truncate text-sm text-gray-400 transition-opacity duration-300 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
              {user.division}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col px-2 py-1.5">
        <h2 className={`px-3 py-1.5 text-sm font-medium text-gray-400 select-none transition-opacity duration-300 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
          เมนู
        </h2>
        <ul className="flex flex-col gap-1.5">
          {links.map((link) => {
            const Icon = link.icon
            const active = location.pathname === link.path
            return (
              <li key={link.path}>
                <Link
                  to={link.path}
                  title={collapsed ? link.name : undefined}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-700 hover:bg-background/50'}`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className={`truncate flex-1 transition-opacity duration-300 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
                    {link.name}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      {user?.is_superuser && !collapsed && (
        <div className="flex flex-col gap-2 px-2 py-3.5 border-background border-t">
          <label htmlFor="pollMins" className="px-3 text-sm font-medium text-gray-400 select-none">
            ความถี่ตำแหน่ง (นาที)
          </label>
          <div className="flex items-center gap-2 px-3">
            <input
              id="pollMins"
              type="number"
              min="1"
              step="0.5"
              value={poll}
              onChange={(e) => setPoll(e.target.value)}
              className="w-20 rounded-lg border text-accent border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none"
            />
            <button
              type="button"
              onClick={savePoll}
              disabled={saving}
              className="rounded-lg bg-primary px-3 py-1 text-sm text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pollSaved ? 'เสร็จสิ้น' : 'ตั้งค่า'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-auto p-2 border-t border-background/50">
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? 'ออกจากระบบ' : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-md text-gray-700 transition-colors hover:bg-background/50 hover:text-brand"
        >
          <LogoutIcon className="w-5 h-5 shrink-0" />
          <span className={`truncate flex-1 text-left transition-opacity duration-300 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
            ออกจากระบบ
          </span>
        </button>
      </div>
    </nav>
  )
}