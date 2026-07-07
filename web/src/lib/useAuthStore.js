import { create } from 'zustand'

import { apiFetch, setOnSessionExpired } from './shared'
import { useSocketStore } from './stateStore'
import { clearRegionsCache } from './useRegions'

// Single source of truth for authentication state. Because auth is cookie-based, the
// store never holds a token — it only tracks the resolved user and a status machine
// ('unknown' -> 'authed' | 'guest') that gates routing/render across the app.
const api = apiFetch

/**
 * Permission check used throughout the UI to show/hide privileged actions.
 * @param {object|null} user  The current user (or null when logged out).
 * @param {string} perm  Permission key to test for.
 * @returns {boolean} true if a user exists and is superuser or holds `perm`.
 */
export const can = (user, perm) =>
  !!user && (user.is_superuser || (user.permissions ?? []).includes(perm))

export const useAuthStore = create((set, get) => ({
  user: null,
  status: 'unknown', // 'unknown' until hydrate() resolves; drives the initial auth gate.

  /**
   * Restore the session on app boot from the existing cookie (no credentials needed).
   * Runs once — bails if status has already moved past 'unknown'.
   */
  async hydrate() {
    if (get().status !== 'unknown') return
    try {
      const res = await api('/users/me/profile')
      if (res.ok) {
        const user = await res.json()
        // The web console is admin-only: field officers authenticate but are refused
        // here and logged back out so their cookie can't linger on the desktop app.
        if (!user.is_admin) {
          await api('/auth/cookie/logout', { method: 'POST' }).catch(() => {})
          set({ user: null, status: 'guest' })
          return
        }
        set({ user, status: 'authed' })
        return
      }
    } catch {
      // Network/parse failure -> fall through to 'guest'; treat as not-logged-in.
    }
    set({ user: null, status: 'guest' })
  },

  /**
   * Log in with credentials, then fetch and validate the profile.
   * @param {string} username
   * @param {string} password
   * @throws {Error} With a localized Thai message on bad credentials, or when a
   *   valid non-admin (field officer) tries to use the web console.
   * @remarks Body is form-urlencoded because the cookie-login endpoint expects
   *   OAuth2 password-flow fields, not JSON.
   */
  async login(username, password) {
    const body = new URLSearchParams({ username, password })
    const res = await api('/auth/cookie/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    console.debug('[auth] login status', res.status)
    if (!res.ok) {
      // Surface the server's detail if present, else a generic "login failed".
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.detail || 'เข้าสู่ระบบไม่สำเร็จ')
    }
    const me = await api('/users/me/profile')
    console.debug('[auth] /users/me/profile status', me.status)
    const user = me.ok ? await me.json() : null
    // Same admin-only gate as hydrate(): reject field officers and point them to mobile.
    if (user && !user.is_admin) {
      await api('/auth/cookie/logout', { method: 'POST' }).catch(() => {})
      set({ user: null, status: 'guest' })
      throw new Error('บัญชีนี้เป็นเจ้าหน้าที่ภาคสนาม กรุณาใช้แอปพลิเคชันมือถือ')
    }
    set({ user, status: user ? 'authed' : 'guest' })
  },

  /**
   * End the session and purge all user-scoped client state so no data leaks to the
   * next user: clears socket data and the cached region tree even if the network
   * logout call fails.
   */
  async logout() {
    try {
      await api('/auth/cookie/logout', { method: 'POST' })
    } catch {
      // Ignore network errors — we still clear local state below regardless.
    }
    useSocketStore.setState({ byType: {} }) // drop live fire data from the previous session.
    clearRegionsCache()                     // force region re-fetch for the next login.
    set({ user: null, status: 'guest' })
  },
}))

// Wire the shared apiFetch's session-expiry hook to this store: an unrecoverable 401
// anywhere resets auth state, which re-renders the app back to the login screen.
setOnSessionExpired(() => useAuthStore.setState({ user: null, status: 'guest' }))