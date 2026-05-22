import { Link } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="navbar">
      <h1>Thai Fire Management System</h1>
      <ul>
        <li><Link to="/map">Map</Link></li>
        <li><Link to="/dashboard">Dashboard</Link></li>
        <li><Link to="/management">Management</Link></li>
      </ul> 
    </nav>
  )
}