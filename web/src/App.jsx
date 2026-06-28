// App.jsx — root, owns the connection, renders the pages
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

function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  if (status === 'unknown') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        กำลังโหลด…
      </div>
    )
  }
  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}

function App() {
  // Zustand store setters
  const handleMessage = useSocketStore((s) => s.handleMessage)
  const setSend = useSocketStore((s) => s.setSend)
  const setReady = useSocketStore((s) => s.setReady)

  const status = useAuthStore((s) => s.status)
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  // The access cookie lives 1h, but the WebSocket (cookie-authed at handshake)
  // can stay open with no HTTP calls to trigger a refresh. Proactively rotate
  // every 45 min while authed so the cookie is always fresh for a WS reconnect.
  useEffect(() => {
    if (status !== 'authed') return
    const id = setInterval(refreshSession, 45 * 60 * 1000)
    return () => clearInterval(id)
  }, [status])

  const wsUrl = import.meta.env.VITE_WS_URL
    ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  
    // Establish WebSocket connection
  const { sendMessage, lastMessage, readyState } = useWebSocket(
    wsUrl,
    {
      shouldReconnect: () => true,
    },
    status === 'authed'
  )

  // receive messages and update Zustand store
  useEffect(() => {
    if (lastMessage !== null) {
      try {
        handleMessage(JSON.parse(lastMessage.data))
      } catch {
        handleMessage(lastMessage.data)
      }
    }
  }, [lastMessage, handleMessage])

  // Sync send function to Zustand — only when sendMessage changes
  useEffect(() => {
    setSend((payload) => {
      sendMessage(typeof payload === 'string' ? payload : JSON.stringify(payload))
    })
  }, [sendMessage, setSend])

  // Sync ready state separately so readyState changes don't recreate send
  useEffect(() => {
    setReady(readyState === ReadyState.OPEN)
  }, [readyState, setReady])

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Toaster />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<SidebarLayout />}>
            <Route path="" element={<MapViewPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/officers" element={<OfficerPage />} />
            <Route path="/dispatchers" element={<DispatcherPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/access" element={<UsersPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App