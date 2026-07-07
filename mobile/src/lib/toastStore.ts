import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; type: ToastType; duration: number }

let nextId = 1

type ToastState = {
  toasts: ToastItem[]
  show: (message: string, type?: ToastType, duration?: number) => number | null
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

export const toast = {
  success: (message: string, duration?: number) => useToastStore.getState().show(message, 'success', duration),
  error: (message: string, duration?: number) => useToastStore.getState().show(message, 'error', duration),
  info: (message: string, duration?: number) => useToastStore.getState().show(message, 'info', duration),
}
