import axios from 'axios'
import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

const API_URL = 'http://10.0.2.2:8000' // Android emulator -> host loopback

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

export async function fetchProvinces(): Promise<Province[]> {
  try {
    const res = await axios.get<Province[]>(`${API_URL}/regions/provinces`)
    return res.data
  } catch {
    return []
  }
}

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await axios.get<AuthUser>(`${API_URL}/users/me`, { withCredentials: true })
    return res.data
  } catch {
    return null
  }
}

export default function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      setUser(await fetchMe())
      setIsLoading(false)
    })()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    try {
      await axios.post(`${API_URL}/auth/cookie/login`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        withCredentials: true,
      })
    } catch {
      throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    }
    setUser(await fetchMe())
    router.replace('/') // guard sends unverified users to /Pending
  }, [])

  const signUp = useCallback(async (email: string, password: string, provinceId: string, name: string) => {
    try {
      await axios.post(`${API_URL}/officers/register`, { email, password, province_id: provinceId, name })
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
      await axios.post(`${API_URL}/auth/cookie/logout`, null, { withCredentials: true })
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