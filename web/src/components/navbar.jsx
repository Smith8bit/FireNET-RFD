import { Link } from "react-router-dom";
import logo from '../assets/RFD_logo.svg'

export default function Navbar() {

  const links = [
    { name: 'Map', path: '/map' },
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Management', path: '/management' },
  ]

  return(
    <nav className="flex text-sm font-medium text-center text-body border-b border-default m-2 mb-0">
      <img
        className="h-12  ml-4"  
        src={logo}/>
      <p className="flex p-4 border-b-2 border-transparent rounded-t-base text-fg-brand">
        Thai Fire Management System
      </p>
      <ul className="flex flex-wrap -mb-px ml-auto">
        {links.map((link) => (
          <li className="me-2" key={link.path}>
            <Link to={link.path} className="inline-block p-4 border-b border-transparent rounded-t-base hover:text-fg-brand hover:border-brand">
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}