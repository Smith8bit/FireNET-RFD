export default function NavBar() {
  return (
    <nav className="navbar">
      <h1>Thai Fire Management System</h1>
      <ul>
        <li><a href="/map">Map</a></li>
        <li><a href="/alerts">Dashboard</a></li>
        <li><a href="/settings">Management</a></li>
      </ul>
    </nav>
  )
}