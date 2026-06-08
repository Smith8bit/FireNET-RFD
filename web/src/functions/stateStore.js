import { create } from 'zustand'

export const useSocketStore = create((set) => ({
  byType: {},
  ready: false,
  send: () => console.warn('Socket not connected yet'),
  handleMessage: (data) => set((state) => ({
    byType: { ...state.byType, [data.type ?? 'fires']: data },
  })),
  setSend: (fn) => set({ send: fn }),
  setReady: (ready) => set({ ready }),
}))

export const useMapSelection = create((set) => ({
  hoveredId: null,
  focusedId: null,
  setHovered: (id) => set({ hoveredId: id }),
  setFocused: (id) => set({ focusedId: id, hoveredId: null }),
  clear:      ()   => set({ hoveredId: null, focusedId: null }),
}))
