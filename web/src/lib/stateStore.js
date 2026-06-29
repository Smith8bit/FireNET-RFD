import { create } from 'zustand'

export const useSocketStore = create((set, get) => ({
  byType: {},
  ready: false,
  send: () => console.warn('Socket not connected yet'),
  handleMessage: (data) => {
    const type = data?.type
    // fires arrive as a versioned snapshot then per-fire deltas; keep the full
    // list under byType.fires so useFireData/map keep reading it unchanged
    if (type === 'fires_snapshot') {
      set((state) => ({
        byType: { ...state.byType, fires: { fires: data.fires ?? [], v: data.v ?? 0 } },
      }))
      return
    }
    if (type === 'fires_delta') {
      const cur = get().byType.fires
      // no baseline yet, or a version gap → ask the server to re-send a snapshot
      if (!cur || data.v !== (cur.v ?? -1) + 1) {
        get().send({ type: 'resync_fires' })
        return
      }
      const byId = new Map(cur.fires.map((f) => [f.id, f]))
      for (const f of data.upserts ?? []) byId.set(f.id, f)
      for (const id of data.removes ?? []) byId.delete(id)
      set((state) => ({
        byType: { ...state.byType, fires: { fires: [...byId.values()], v: data.v } },
      }))
      return
    }
    // officer + other typed messages keep the replace-by-type behavior
    set((state) => ({
      byType: { ...state.byType, [type ?? 'fires']: data },
    }))
  },
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
