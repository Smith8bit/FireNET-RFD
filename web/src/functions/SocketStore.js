import { create } from 'zustand'

export const useSocketStore = create((set) => ({
  lastMessage: null,
  isReady: false,
  send: () => console.warn('Socket not connected yet'),
  setLastMessage: (data) => set({ lastMessage: data }),
  setSend: (fn) => set({ send: fn }),
  setReady: (ready) => set({ isReady: ready }),

  isAuthenticated: false,
  user: null,
  login: (userData) => set({ isAuthenticated: true, user: userData }),
  logout: () => set({ isAuthenticated: false, user: null }),
}))