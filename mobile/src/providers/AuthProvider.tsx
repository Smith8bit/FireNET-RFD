import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

const API_URL = 'http://10.0.2.2:8000'

export type AuthUser = {
  id: string
  email: string
  is_active: boolean
  is_superuser: boolean
  is_verified: boolean
}

type AuthContextType = {
  user: AuthUser | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
})

export function useAuthSession() {
  return useContext(AuthContext)
}

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/users/me`, { method: 'GET', credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as AuthUser
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
    // fastapi-users login expects form-encoded "username" + "password"
    const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    const res = await fetch(`${API_URL}/auth/cookie/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body,
    })
    if (!res.ok) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    setUser(await fetchMe())
    router.replace('/')
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      let detail = 'สมัครสมาชิกไม่สำเร็จ'
      try {
        const data = await res.json()
        if (data?.detail === 'REGISTER_USER_ALREADY_EXISTS') detail = 'อีเมลนี้ถูกใช้งานแล้ว'
      } catch {}
      throw new Error(detail)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/cookie/logout`, { method: 'POST', credentials: 'include' })
    } catch {}
    setUser(null)
    router.replace('/Login')
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}