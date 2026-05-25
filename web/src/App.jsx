// App.jsx — root, owns the connection, renders the pages
import { useEffect } from 'react'
import useWebSocket, { ReadyState } from 'react-use-websocket'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'

import Navbar from './components/navbar'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ManagementPage from './pages/ManagementPage'
import MapViewPage from './pages/MapViewPage'
import { useSocketStore } from './functions/SocketStore'

import './App.css'

function NavbarLayout() {
  return (
    <div className="flex flex-col h-screen">
      <Navbar />
      <Outlet />
    </div>
  )
}

function App() {

  // Zustand store setters
  const setLastMessage = useSocketStore((s) => s.setLastMessage)
  const setSend = useSocketStore((s) => s.setSend)
  const setReady = useSocketStore((s) => s.setReady)

  // Establish WebSocket connection
  const { sendMessage, lastMessage, readyState } = useWebSocket(
    'ws://127.0.0.1:8000/ws',
    {
      onOpen: () => console.log('WebSocket Connected'),
      shouldReconnect: () => true,
    }
  )

  // receive messages and update Zustand store
  useEffect(() => {
    if (lastMessage !== null) {
      try {
        setLastMessage(JSON.parse(lastMessage.data))
      } catch {
        setLastMessage(lastMessage.data)
      }
    }
  }, [lastMessage, setLastMessage])

  // Sync send function and socket readiness to Zustand
  useEffect(() => {
    setSend((payload) => {
      // Auto-stringify objects before sending through WebSocket
      sendMessage(typeof payload === 'string' ? payload : JSON.stringify(payload))
    })
    setReady(readyState === ReadyState.OPEN)
  }, [sendMessage, readyState, setSend, setReady])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<NavbarLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/map" element={<MapViewPage />} />
          <Route path="/management" element={<ManagementPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App