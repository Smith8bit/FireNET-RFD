// Global toast/snackbar queue. Modeled as a Zustand store (rather than React
// context) specifically so `toast.success(...)` can be called from anywhere
// — including non-component code like the axios interceptors in lib/api.ts —
// without needing a hook or being inside the component tree.
import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; type: ToastType; duration: number }

// Simple incrementing counter for toast identity within a session; a UUID
// would be overkill since ids only need to be unique among concurrently
// visible toasts, not persisted or compared across sessions.
let nextId = 1

type ToastState = {
  toasts: ToastItem[]
  /**
   * Queues a toast for display.
   * @param message - text to show; empty/falsy messages are silently ignored.
   * @param type - visual style, defaults to 'success'.
   * @param duration - auto-dismiss time in ms, defaults to 3000.
   * @returns the new toast's id (for manual dismissal), or null if the
   * message was empty and nothing was queued.
   */
  show: (message: string, type?: ToastType, duration?: number) => number | null
  /** Removes a toast by id, e.g. after its duration elapses or on user dismiss. */
  dismiss: (id: number) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, type = 'success', duration = 3000) => {
    if (!message) return null
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Ergonomic, hook-free API for firing toasts from anywhere (services, stores,
// interceptors) via `useToastStore.getState()` instead of the `useToastStore()` hook.
export const toast = {
  success: (message: string, duration?: number) => useToastStore.getState().show(message, 'success', duration),
  error: (message: string, duration?: number) => useToastStore.getState().show(message, 'error', duration),
  info: (message: string, duration?: number) => useToastStore.getState().show(message, 'info', duration),
}
