import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

const API_URL = 'http://127.0.0.1:8000'

const AuthContext = createContext<{
  signIn: (identifier: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  token: string | null
  isLoading: boolean
}>({
  signIn: async () => {},
  signOut: async () => {},
  token: null,
  isLoading: true,
})

export function useAuthSession() {
  return useContext(AuthContext)
}

export default function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const stored = await AsyncStorage.getItem('@token')
      setToken(stored ?? null)
      setIsLoading(false)
      if (!stored) {
        router.replace('/Login')
      }
    })()
  }, [])

  const signIn = useCallback(async (newToken: string) => {
    await AsyncStorage.setItem('@token', newToken)
    setToken(newToken)
    router.replace('/')
  }, [])

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem('@token')
    setToken(null)
    router.replace('/Login')
  }, [])

  return (
    <AuthContext.Provider value={{ signIn, signOut, token, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}
