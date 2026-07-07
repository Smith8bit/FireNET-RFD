import { useEffect } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'

import Sidebar from './components/sidebar'
import Toaster from './components/Toaster'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import OfficerPage from './pages/OfficerPage'
import DispatcherPage from './pages/DispatcherPage'
import HistoryPage from './pages/HistoryPage'
import AuditPage from './pages/AuditPage'
import UsersPage from './pages/UsersPage'
import MapViewPage from './pages/MapViewPage'
import { useSocketStore } from './lib/stateStore'
import { useAuthStore } from './lib/useAuthStore'
import { refreshSession } from './lib/shared'

import './App.css'

/**
 * Shared chrome for all authenticated, non-login pages: a fixed sidebar
 * beside a scrollable content area. Nested routes render into <Outlet />.
 * @returns {JSX.Element} Full-height flex layout wrapping the active route.
 */
function SidebarLayout() {
  return (
    <div className="flex flex-row h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Route guard that gates its nested <Outlet /> behind auth status from
 * useAuthStore. Renders a loading state while the session is still being
 * resolved (e.g. on first load / hard refresh) instead of prematurely
 * redirecting, which would otherwise bounce authenticated users to /login.
 * @returns {JSX.Element} Loading placeholder, redirect to /login, or the
 * protected outlet, depending on auth status.
 */
function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  // Captured so /login can send the user back to where they were headed
  // after a successful sign-in.
  const location = useLocation()
  if (status === 'unknown') {
    // hydrate() in App() hasn't resolved yet; avoid a flash-redirect to /login.
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        กำลังโหลด…
      </div>
    )
  }
  if (status === 'guest') {
    // replace (not push) so the login page doesn't get stacked in history.
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}

/**
 * Application root: owns session bootstrap, the single shared WebSocket
 * connection, and top-level routing. Bridges react-use-websocket (a hook,
 * tied to this component's lifecycle) into useSocketStore (a plain store)
 * so any descendant can read/send socket data without prop drilling.
 * @returns {JSX.Element} The routed application shell.
 */
function App() {
  // Store setters used to publish socket state/behavior outward; components
  // elsewhere subscribe to the store rather than calling useWebSocket directly.
  const handleMessage = useSocketStore((s) => s.handleMessage)
  const setSend = useSocketStore((s) => s.setSend)
  const setReady = useSocketStore((s) => s.setReady)

  const status = useAuthStore((s) => s.status)
  const hydrate = useAuthStore((s) => s.hydrate)

  // Resolve auth status once on mount (e.g. validate an existing cookie/token)
  // before RequireAuth decides whether to redirect to /login.
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // While authenticated, proactively refresh the session on a fixed cadence
  // so it doesn't expire mid-use. Assumes the backend session/token lifetime
  // is longer than 45 minutes. Cleared on logout or unmount to avoid leaks.
  useEffect(() => {
    if (status !== 'authed') return
    const id = setInterval(refreshSession, 45 * 60 * 1000)
    return () => clearInterval(id)
  }, [status])

  // Prefer an explicit env override (useful for pointing at a different
  // backend in dev); otherwise derive ws(s) from the current page so the
  // scheme always matches (avoids mixed-content blocks under https).
  const wsUrl = import.meta.env.VITE_WS_URL
    ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

  // Only open the socket once authenticated (last arg = connect condition);
  // shouldReconnect keeps it alive across transient drops.
  const { sendMessage, lastMessage, readyState } = useWebSocket(
    wsUrl,
    {
      shouldReconnect: () => true,
    },
    status === 'authed'
  )

  // Forward each inbound frame to the store. Server messages are expected to
  // be JSON; a raw/non-JSON payload is passed through as-is instead of
  // throwing, so malformed frames don't crash the app.
  useEffect(() => {
    if (lastMessage !== null) {
      try {
        handleMessage(JSON.parse(lastMessage.data))
      } catch {
        handleMessage(lastMessage.data)
      }
    }
  }, [lastMessage, handleMessage])

  // Expose a single send() in the store that auto-serializes objects,
  // so callers don't need to know whether the payload is already a string.
  useEffect(() => {
    setSend((payload) => {
      sendMessage(typeof payload === 'string' ? payload : JSON.stringify(payload))
    })
  }, [sendMessage, setSend])

  // Mirror the low-level ReadyState enum down to a simple boolean so
  // consumers of the store don't need to import react-use-websocket.
  useEffect(() => {
    setReady(readyState === ReadyState.OPEN)
  }, [readyState, setReady])

  return (
    // basename supports deploying under a sub-path (e.g. GitHub Pages / reverse proxy).
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Toaster />
      <Routes>
        {/* Only public route; everything else requires a session. */}
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<SidebarLayout />}>
            {/* index route ("") is the map view, i.e. the post-login landing page */}
            <Route path="" element={<MapViewPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/officers" element={<OfficerPage />} />
            <Route path="/dispatchers" element={<DispatcherPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/access" element={<UsersPage />} />
          </Route>
        </Route>
        {/* Unknown paths fall back to the index route rather than a 404 page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App