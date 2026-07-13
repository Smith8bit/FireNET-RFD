import { create } from 'zustand'

// Global toast queue. Held in a store (not local component state) so any module —
// including non-React code like the API layer — can raise a notification via the
// `toast` helper below, and a single <Toaster> renders them.

// Monotonic counter for stable React keys; module-level so ids stay unique for the
// whole session regardless of how many toasts come and go.
let nextId = 1

export const useToastStore = create((set) => ({
  toasts: [], // active toasts, rendered in insertion order.
  /**
   * Enqueue a toast.
   * @param {string} message  Text to display; falsy messages are ignored.
   * @param {'success'|'error'|'info'} [type='success']  Visual style.
   * @param {number} [duration=3000]  Auto-dismiss delay in ms (the Toaster honours it).
   * @returns {number|null} The new toast id, or null if `message` was empty.
   */
  show: (message, type = 'success', duration = 3000) => {
    if (!message) return null
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    return id
  },
  // Remove a toast by id (called on timeout or manual close).
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Convenience API so callers write `toast.error('...')` instead of reaching into the
// store. getState() is used to allow firing toasts from outside React render context.
export const toast = {
  success: (message, duration) => useToastStore.getState().show(message, 'success', duration),
  error: (message, duration) => useToastStore.getState().show(message, 'error', duration),
  info: (message, duration) => useToastStore.getState().show(message, 'info', duration),
}
