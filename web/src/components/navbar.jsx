import { Link, useNavigate, useLocation } from "react-router-dom";
import logo from '../assets/RFD_logo.svg'
import { useAuthStore } from "../functions/useAuthStore";

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const links = [
    { name: 'Map View', path: '/map' },
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Management', path: '/management' },
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/', {replace: true})
  }

return (
    <nav className="flex justify-between items-center px-2 bg-white font-medium text-md">
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
      <span className="font-light italic bg-primary-foreground border-2 border-gray-300 rounded-full px-4 py-1">
        {user.email}
      </span>
      <ul className="flex h-full">
        {links.map((link) => (
          <li className="h-full " key={link.path}>
            <Link
              to={link.path}
              className={`h-full flex items-center px-3 hover:bg-forest-100 hover:text-forest-700 ${location.pathname === link.path ? 'bg-forest-100 text-forest-700' : ''}`}
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