import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, setOnUnauthorized, loadToken, setToken, clearToken, getRefreshToken } from '@/lib/api'
import { registerPushToken, unregisterPushToken } from '@/lib/push'
import { useFireStore } from '@/stores/fireStore'

// opening map view {lng, lat, zoom} for the region this officer covers
export type Home = { lat: number; lng: number; zoom: number }
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
  isLoading: boolean
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string, provinceId: string, name: string, division: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

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


async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await api.get<AuthUser>('/users/me/profile', { timeout: 8000 })
    return res.data
  } catch {
    return null
  }
}

// a verified field officer can receive appointments → register this device for push
function maybeRegisterPush(user: AuthUser | null) {
  if (user?.is_field_officer && user.is_verified) {
    registerPushToken().catch(() => {})
  }
}

export default function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // expired/invalid session on any API call → drop the token, return to Login
    setOnUnauthorized(() => {
      clearToken()
      setUser(null)
      router.replace('/Login')
    })
    ;(async () => {
      await loadToken() // restore the saved bearer token before the first request
      const me = await fetchMe()
      // a non-officer account (admin/dispatcher) doesn't belong in the mobile app
      if (me && !me.is_field_officer) {
        await clearToken()
        setUser(null)
      } else {
        setUser(me)
        maybeRegisterPush(me)
      }
      setIsLoading(false)
    })()
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    try {
      const res = await api.post<{ access_token: string; refresh_token: string }>('/auth/jwt/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      await setToken(res.data.access_token, res.data.refresh_token)
    } catch {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    }
    const me = await fetchMe()
    if (me && !me.is_field_officer) {
      // logged in fine, but this is an admin/dispatcher account — block mobile access
      await clearToken()
      setUser(null)
      throw new Error('บัญชีนี้เป็นผู้ดูแลระบบ กรุณาใช้งานผ่านเว็บ')
    }
    setUser(me)
    maybeRegisterPush(me)
    router.replace('/') // guard sends unverified users to /Pending
  }, [])

  const signUp = useCallback(async (username: string, password: string, provinceCode: string, name: string, division: string) => {
    try {
      await api.post('/officers/register', { username, password, province_code: provinceCode, name, division })
    } catch (e: any) {
      let detail = 'สมัครสมาชิกไม่สำเร็จ'
      const d = e?.response?.data
      if (d?.detail === 'REGISTER_USER_ALREADY_EXISTS') detail = 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว'
      else if (typeof d?.detail === 'string') detail = d.detail
      throw new Error(detail)
    }
  }, [])

  const signOut = useCallback(async () => {
    // drop this device's push token first, while the token is still valid
    await unregisterPushToken()
    // best-effort: drop server-side online so the officer doesn't show online on
    // the admin map until the TTL expires. Non-blocking + before clearToken (token
    // still valid); a bad network must not hang logout.
    api.patch('/officers/me/location', { active: false }).catch(() => {})
    // revoke the refresh token server-side so a stolen copy can't be replayed
    // (best-effort, before clearToken empties it); then discard everything locally
    const refresh = getRefreshToken()
    if (refresh) api.post('/auth/jwt/logout', { refresh_token: refresh }).catch(() => {})
    await clearToken()
    // clear the stale online flag so a re-login (shared device) doesn't push the
    // new account's location before loadStatus() reconciles
    useFireStore.setState({ online: false })
    setUser(null)
    router.replace('/Login')
  }, [])

  const refresh = useCallback(async () => {
    setUser(await fetchMe())
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}