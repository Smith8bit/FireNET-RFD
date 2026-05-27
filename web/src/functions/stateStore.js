import { create } from 'zustand'

export const useSocketStore = create((set) => ({
  lastMessage: null,
  isReady: false,
  send: () => console.warn('Socket not connected yet'),
  setLastMessage: (data) => set({ lastMessage: data }),
  setSend: (fn) => set({ send: fn }),
  setReady: (ready) => set({ isReady: ready }),
}))

export const useHoverStore = create((set) => ({
  hoveredMarker: null,
  setHoveredMarker: (marker) => set({ hoveredMarker: marker }),
}))

export const useFocusedSpotStore = create((set) => ({
  focusedSpot: null,
  setSpot: (spot) => set({ focusedSpot: spot }),
}))

