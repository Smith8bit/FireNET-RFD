// App.jsx — root, owns the connection, renders the pages
import { useEffect } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'

import Navbar from './components/navbar'
import Toaster from './components/Toaster'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ManagementPage from './pages/ManagementPage'
import MapViewPage from './pages/MapViewPage'
import { useSocketStore } from './functions/stateStore'
import { useAuthStore } from './functions/useAuthStore'

import './App.css'

function NavbarLayout() {
  return (
    <div className="flex flex-col h-screen">
      <Navbar />
      <Outlet />
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
    return <Navigate to="/" replace state={{ from: location }} />
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
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<NavbarLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/map" element={<MapViewPage />} />
            <Route path="/management" element={<ManagementPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App