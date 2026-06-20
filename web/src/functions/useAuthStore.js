import { create } from 'zustand'

import { API_URL } from '../components/management/shared'

async function api(path, init = {}) {
  return fetch(`${API_URL}${path}`, { credentials: 'include', ...init })
}

// per-resource UI gate: superuser holds everything, others check their effective set
export const can = (user, perm) =>
  !!user && (user.is_superuser || (user.permissions ?? []).includes(perm))

export const useAuthStore = create((set, get) => ({
  user: null,
  status: 'unknown', // 'unknown' | 'guest' | 'authed'

  async hydrate() {
    if (get().status !== 'unknown') return
    try {
      const res = await api('/users/me/profile')
      if (res.ok) {
        const user = await res.json()
        if (!user.is_admin) {
          // field officers belong in the mobile app, not the web console
          await api('/auth/cookie/logout', { method: 'POST' }).catch(() => {})
          set({ user: null, status: 'guest' })
          return
        }
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
    const me = await api('/users/me/profile')
    console.debug('[auth] /users/me/profile status', me.status)
    const user = me.ok ? await me.json() : null
    if (user && !user.is_admin) {
      // logged in fine, but this is a field-officer account — block web access
      await api('/auth/cookie/logout', { method: 'POST' }).catch(() => {})
      set({ user: null, status: 'guest' })
      throw new Error('บัญชีนี้เป็นเจ้าหน้าที่ภาคสนาม กรุณาใช้แอปพลิเคชันมือถือ')
    }
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