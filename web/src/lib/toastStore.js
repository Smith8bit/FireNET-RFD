import { create } from 'zustand'

let nextId = 1

// A tiny global toast queue. Any component (or plain module code) can push a
// toast via the `toast` helper below; a single <Toaster> mounted at the app
// root renders the stack, so toasts survive route changes and tab unmounts.
export const useToastStore = create((set) => ({
  toasts: [],
  show: (message, type = 'success', duration = 3000) => {
    if (!message) return null
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (message, duration) => useToastStore.getState().show(message, 'success', duration),
  error: (message, duration) => useToastStore.getState().show(message, 'error', duration),
  info: (message, duration) => useToastStore.getState().show(message, 'info', duration),
}
