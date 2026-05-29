import { Link, useNavigate } from "react-router-dom";
import logo from '../assets/RFD_logo.svg'
import { useAuthStore } from "../functions/useAuthStore";

export default function Navbar() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const links = [
    { name: 'Map', path: '/map' },
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Management', path: '/management' },
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/', {replace: true})
  }

return (
    <nav className="flex items-center text-sm font-medium text-center text-body border-b border-default m-2 mb-0">
      <img
        className="h-12 ml-4"
        src={logo}
        alt="Royal Forest Department logo"
      />
      <p className="flex p-4 border-b-2 border-transparent rounded-t-base text-fg-brand">
        Thai Fire Management System
      </p>
      <ul className="flex flex-wrap -mb-px ml-auto items-center">
        {links.map((link) => (
          <li className="me-2" key={link.path}>
            <Link
              to={link.path}
              className="inline-block p-4 border-b border-transparent rounded-t-base hover:text-fg-brand hover:border-brand"
            >
              {link.name}
            </Link>
          </li>
        ))}
        {user && (
          <li className="me-4 flex items-center gap-3">
            <span className="text-gray-600 text-xs">{user.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 bg-forest-500 hover:bg-forest-600 text-white rounded-lg text-sm"
            >
              ออกจากระบบ
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}