import { useEffect, useState } from 'react'
import useWebSocket from 'react-use-websocket'
import { create } from 'zustand'
import './App.css'

// Create a Zustand store to manage WebSocket messages
const useSocketStore = create((set) => ({
    messages: [],
    addMessage: (data) => set((state) => ({ messages: [...state.messages, data].slice(-10) })),
}))

function App() {
  
  const messages = useSocketStore((s) => s.messages)
  const addMessage = useSocketStore((s) => s.addMessage)

  // Set up WebSocket connection
  const { sendMessage, lastMessage } = useWebSocket('ws://127.0.0.1:8000/ws', {
    onOpen: () => console.log('WebSocket Connected'),
    shouldReconnect: (closeEvent) => true,
  })

  return (
    <>
    </>
  )
}

export default App
