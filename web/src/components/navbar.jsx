import { Link } from "react-router-dom";

export default function Navbar() {

  const links = [
    { name: 'Map', path: '/map' },
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Management', path: '/management' },
  ]

  return(
    <nav>
      <ul>
        {links.map((link) => (
          <li key={link.path}>
            <Link to={link.path}>{link.name}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}