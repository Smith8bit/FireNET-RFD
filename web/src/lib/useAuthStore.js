import { create } from 'zustand'

import { apiFetch, setOnSessionExpired } from './shared'
import { useSocketStore } from './stateStore'
import { clearRegionsCache } from './useRegions'

const api = apiFetch

export const can = (user, perm) =>
  !!user && (user.is_superuser || (user.permissions ?? []).includes(perm))

export const useAuthStore = create((set, get) => ({
  user: null,
  status: 'unknown',

  async hydrate() {
    if (get().status !== 'unknown') return
    try {
      const res = await api('/users/me/profile')
      if (res.ok) {
        const user = await res.json()
        if (!user.is_admin) {
          await api('/auth/cookie/logout', { method: 'POST' }).catch(() => {})
          set({ user: null, status: 'guest' })
          return
        }
        set({ user, status: 'authed' })
        return
      }
    } catch {
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
    }
    useSocketStore.setState({ byType: {} })
    clearRegionsCache()
    set({ user: null, status: 'guest' })
  },
}))

setOnSessionExpired(() => useAuthStore.setState({ user: null, status: 'guest' }))