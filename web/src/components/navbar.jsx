import { Link } from "react-router-dom";

export default function Navbar() {

  const links = [
    { name: 'Map', path: '/map' },
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Management', path: '/management' },
  ]

  return(
    <nav className="h-16 bg-gray-800 text-white flex items-center px-4">
      <ul className="flex space-x-4">
        {links.map((link) => (
          <li key={link.path}>
            <Link to={link.path} className="hover:text-blue-300">
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}