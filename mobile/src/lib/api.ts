import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL
if (!API_URL) {
  throw new Error('EXPO_PUBLIC_API_URL is not set — add it to mobile/.env')
}

const TOKEN_KEY = 'tfms_access_token'

export const api = axios.create({ baseURL: API_URL })

// The bearer token is kept in memory for the request interceptor and mirrored to
// the device keystore (expo-secure-store) so the session survives app restarts.
// Native cookie persistence in React Native is unreliable, so mobile uses tokens.
let accessToken: string | null = null

/** Restore the saved token at startup. Call before the first authenticated request. */
export async function loadToken(): Promise<string | null> {
  accessToken = await SecureStore.getItemAsync(TOKEN_KEY)
  return accessToken
}

/** The in-memory bearer token, for callers that build their own requests (e.g. <Image> headers). */
export function getToken(): string | null {
  return accessToken
}

export async function setToken(token: string): Promise<void> {
  accessToken = token
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function clearToken(): Promise<void> {
  accessToken = null
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// login probe failures are handled where they happen, not as a session expiry
const AUTH_PROBE_PATHS = ['/auth/jwt/login', '/users/me']

let onUnauthorized: (() => void) | null = null

/** Called once (AuthProvider) so an expired session sends the user back to Login. */
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler
}

api.interceptors.response.use(undefined, (error) => {
  const status = error?.response?.status
  const url: string = error?.config?.url ?? ''
  if (status === 401 && !AUTH_PROBE_PATHS.some((p) => url.includes(p))) {
    onUnauthorized?.()
  }
  return Promise.reject(error)
})
