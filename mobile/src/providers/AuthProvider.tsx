// React context that owns the app's auth/session lifecycle: loading the
// persisted session on boot, sign-in/up/out, and keeping the cached user
// profile fresh. This is the only module that talks to both lib/api's token
// functions and React state, so it's also where the api layer's 401 handler
// gets wired up (see setOnUnauthorized below).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, setOnUnauthorized, loadToken, setToken, clearToken, getRefreshToken, getToken } from '@/lib/api'
import { registerPushToken, unregisterPushToken } from '@/lib/push'
import { useFireStore } from '@/stores/fireStore'

/** An officer's default map center/zoom, set by admins to their assigned area. */
export type Home = { lat: number; lng: number; zoom: number }

// Mirrors the backend's user schema. This mobile app is field-officer-only
// (see maybeRegisterPush / the is_field_officer checks below); admin/superuser
// fields are present because the API returns them, not because this app acts on them.
export type AuthUser = {
  id: string
  username: string
  division: string | null
  is_active: boolean
  is_superuser: boolean
  is_verified: boolean
  name: string | null
  is_admin: boolean
  is_field_officer: boolean
  home: Home
}

export type Province = { id: string; code: string; name_th: string; name_en: string | null; path: string }

type AuthContextType = {
  user: AuthUser | null
  /** True until the initial session-restore attempt (on app boot) completes. */
  isLoading: boolean
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string, provinceId: string, name: string, division: string) => Promise<void>
  signOut: () => Promise<void>
  /** Re-fetches and caches the current user profile (e.g. after editing settings elsewhere). */
  refresh: () => Promise<void>
}

// Default values are inert placeholders; real implementations are supplied
// by the <AuthProvider> below and only reachable once mounted.
const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signIn: async () => {},
  signUp: async () => { },
  signOut: async () => {},
  refresh: async () => {},
})

export function useAuthSession() {
  return useContext(AuthContext)
}


/**
 * Fetches the current user's profile from the backend.
 * @returns the profile, or null on any failure (offline, expired session,
 * server error) — callers use this to distinguish "definitely logged out"
 * from "couldn't confirm right now" and fall back to cached state accordingly.
 */
async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await api.get<AuthUser>('/users/me/profile', { timeout: 8000 })
    return res.data
  } catch {
    return null
  }
}

const USER_KEY = 'firenet_user'
/** Persists (or clears, when `u` is null) the last-known profile for offline/optimistic boot. */
async function cacheUser(u: AuthUser | null): Promise<void> {
  try {
    if (u) await AsyncStorage.setItem(USER_KEY, JSON.stringify(u))
    else await AsyncStorage.removeItem(USER_KEY)
  } catch {}
}
async function loadCachedUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

// Business rule: only verified field officers receive push notifications
// (unverified accounts have nothing to be dispatched to yet, and admins use
// the separate web dashboard, not this app).
function maybeRegisterPush(user: AuthUser | null) {
  if (user?.is_field_officer && user.is_verified) {
    registerPushToken().catch(() => {})
  }
}

export default function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Registers the handler lib/api.ts's response interceptor calls when a
    // token refresh fails — completes the inversion-of-control link so the
    // low-level HTTP layer can trigger a logout without importing this module.
    setOnUnauthorized(() => {
      clearToken()
      setUser(null)
      router.replace('/Login')
    })
    ;(async () => {
      await loadToken()
      const me = await fetchMe()
      if (me && !me.is_field_officer) {
        // This app is field-officer-only; a valid session for a non-field
        // account (admin) is treated as not usable here and is logged out.
        await clearToken()
        await cacheUser(null)
        setUser(null)
      } else if (me) {
        setUser(me)
        cacheUser(me)
        maybeRegisterPush(me)
      } else if (getToken()) {
        // A token exists but the profile fetch failed — most likely offline
        // rather than actually signed out, so restore the last-known profile
        // optimistically instead of forcing a login screen.
        setUser(await loadCachedUser())
      }
      setIsLoading(false)
    })()
  }, [])

  /**
   * @param username
   * @param password
   * @throws localized (Thai) Error on invalid credentials or if the account
   * is not a field officer (this app rejects admin logins, directing them to
   * the web dashboard instead).
   */
  const signIn = useCallback(async (username: string, password: string) => {
    // OAuth2 password-grant login endpoint expects form-urlencoded body, not JSON.
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    try {
      const res = await api.post<{ access_token: string; refresh_token: string }>('/auth/jwt/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      await setToken(res.data.access_token, res.data.refresh_token)
    } catch {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง') // "Incorrect username or password"
    }
    const me = await fetchMe()
    if (me && !me.is_field_officer) {
      // Credentials were valid but the account isn't a field officer — undo
      // the token we just stored rather than leaving a half-signed-in state.
      await clearToken()
      await cacheUser(null)
      setUser(null)
      throw new Error('บัญชีนี้เป็นผู้ดูแลระบบ กรุณาใช้งานผ่านเว็บ') // "This is an admin account, please use the web app"
    }
    setUser(me)
    cacheUser(me)
    maybeRegisterPush(me)
    router.replace('/')
  }, [])

  /**
   * Registers a new field officer account.
   * @param username
   * @param password
   * @param provinceCode - assigns the officer's jurisdiction (drives which
   * fires they're permitted to see/reserve server-side).
   * @param name - display name.
   * @param division - officer's organizational division.
   * @throws localized Error with the backend's reason, or a specific message
   * for the known "username already exists" case.
   */
  const signUp = useCallback(async (username: string, password: string, provinceCode: string, name: string, division: string) => {
    try {
      await api.post('/officers/register', { username, password, province_code: provinceCode, name, division })
    } catch (e: any) {
      let detail = 'สมัครสมาชิกไม่สำเร็จ' // "Registration failed"
      const d = e?.response?.data
      if (d?.detail === 'REGISTER_USER_ALREADY_EXISTS') detail = 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' // "Username already taken"
      else if (typeof d?.detail === 'string') detail = d.detail
      throw new Error(detail)
    }
  }, [])

  const signOut = useCallback(async () => {
    await unregisterPushToken()
    // Mark the officer offline/logout server-side best-effort — these must
    // not block sign-out if the network is unavailable.
    api.patch('/officers/me/location', { active: false }).catch(() => {})
    const refresh = getRefreshToken()
    if (refresh) api.post('/auth/jwt/logout', { refresh_token: refresh }).catch(() => {}) // revokes the refresh token server-side
    await clearToken()
    await cacheUser(null)
    // Reset in-memory fire state so the next login (possibly a different
    // officer on a shared device) doesn't briefly see the previous session's data.
    useFireStore.setState({ online: false, fires: [], reservedFire: null })
    setUser(null)
    router.replace('/Login')
  }, [])

  const refresh = useCallback(async () => {
    const me = await fetchMe()
    if (me) {
      setUser(me)
      cacheUser(me)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}