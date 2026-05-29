import { create } from 'zustand'

const API_URL = import.meta.env.VITE_API_URL ?? ''

async function api(path, init = {}) {
  return fetch(`${API_URL}${path}`, { credentials: 'include', ...init })
}

export const useAuthStore = create((set, get) => ({
  user: null,
  status: 'unknown', // 'unknown' | 'guest' | 'authed'

  async hydrate() {
    if (get().status !== 'unknown') return
    try {
      const res = await api('/users/me')
      if (res.ok) {
        const user = await res.json()
        set({ user, status: 'authed' })
        return
      }
    } catch {
      // network error → treat as guest, the UI will show the login page
    }
    set({ user: null, status: 'guest' })
  },

  async login(username, password) {
    const body = new URLSearchParams({ username, password })
    const res = await api('/auth/cookie/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    console.debug('[auth] login status', res.status)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.detail || 'เข้าสู่ระบบไม่สำเร็จ')
    }
    const me = await api('/users/me')
    console.debug('[auth] /users/me status', me.status)
    const user = me.ok ? await me.json() : null
    console.debug('[auth] user', user, 'status →', user ? 'authed' : 'guest')
    set({ user, status: user ? 'authed' : 'guest' })
  },

  async logout() {
    try {
      await api('/auth/cookie/logout', { method: 'POST' })
    } catch {
      // ignore — clear local state regardless
    }
    set({ user: null, status: 'guest' })
  },
}))