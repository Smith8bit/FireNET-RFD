import { create } from 'zustand'

export const useSocketStore = create((set) => ({
  lastMessage: null,
  ready: false,
  send: () => console.warn('Socket not connected yet'),
  setLastMessage: (data) => set({ lastMessage: data }),
  setSend: (fn) => set({ send: fn }),
  setReady: (ready) => set({ isReady: ready }),
}))

export const useMapSelection = create((set) => ({
  hoveredId: null,
  focusedId: null,
  setHovered: (id) => set({ hoveredId: id }),
  setFocused: (id) => set({ focusedId: id, hoveredId: null }),
  clear:      ()   => set({ hoveredId: null, focusedId: null }),
}))
