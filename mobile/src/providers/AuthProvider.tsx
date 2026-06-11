import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, setOnUnauthorized } from '@/lib/api'

export type AuthUser = {
  id: string
  email: string
  is_active: boolean
  is_superuser: boolean
  is_verified: boolean
}
export type Province = { id: string; code: string; name_th: string; name_en: string | null; path: string }

type AuthContextType = {
  user: AuthUser | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, provinceId: string, name: string) => Promise<void>
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
    const res = await api.get<AuthUser>('/users/me', { timeout: 8000 })
    return res.data
  } catch {
    return null
  }
}

export default function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // expired/invalid session on any API call → clear state and return to Login
    setOnUnauthorized(() => {
      setUser(null)
      router.replace('/Login')
    })
    ;(async () => {
      setUser(await fetchMe())
      setIsLoading(false)
    })()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    try {
      await api.post('/auth/cookie/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    } catch {
      throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    }
    setUser(await fetchMe())
    router.replace('/') // guard sends unverified users to /Pending
  }, [])

  const signUp = useCallback(async (email: string, password: string, provinceCode: string, name: string) => {
    try {
      await api.post('/officers/register', { email, password, province_code: provinceCode, name })
    } catch (e: any) {
      let detail = 'สมัครสมาชิกไม่สำเร็จ'
      const d = e?.response?.data
      if (d?.detail === 'REGISTER_USER_ALREADY_EXISTS') detail = 'อีเมลนี้ถูกใช้งานแล้ว'
      else if (typeof d?.detail === 'string') detail = d.detail
      throw new Error(detail)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/cookie/logout', null)
    } catch {}
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