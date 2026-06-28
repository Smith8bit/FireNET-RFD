import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL
if (!API_URL) {
  throw new Error('EXPO_PUBLIC_API_URL is not set — add it to mobile/.env')
}

const TOKEN_KEY = 'tfms_access_token'
const REFRESH_KEY = 'tfms_refresh_token'

export const api = axios.create({ baseURL: API_URL })

// The short-lived access token is kept in memory for the request interceptor and
// mirrored to the device keystore (expo-secure-store) so the session survives app
// restarts. The long-lived refresh token rides alongside it; when the access token
// 401s, the response interceptor below silently swaps it for a fresh one.
// Native cookie persistence in React Native is unreliable, so mobile uses tokens.
let accessToken: string | null = null
let refreshToken: string | null = null

/** Restore the saved tokens at startup. Call before the first authenticated request. */
export async function loadToken(): Promise<string | null> {
  accessToken = await SecureStore.getItemAsync(TOKEN_KEY)
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY)
  return accessToken
}

/** The in-memory bearer token, for callers that build their own requests (e.g. <Image> headers). */
export function getToken(): string | null {
  return accessToken
}

/** Persist a fresh access (+ refresh) token pair from login or refresh. */
export async function setToken(access: string, refresh?: string): Promise<void> {
  accessToken = access
  await SecureStore.setItemAsync(TOKEN_KEY, access)
  if (refresh !== undefined) {
    refreshToken = refresh
    await SecureStore.setItemAsync(REFRESH_KEY, refresh)
  }
}

export function getRefreshToken(): string | null {
  return refreshToken
}

export async function clearToken(): Promise<void> {
  accessToken = null
  refreshToken = null
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  await SecureStore.deleteItemAsync(REFRESH_KEY)
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// login failures are handled where they happen, not as a session expiry. (The
// refresh call uses bare axios, so it never re-enters this interceptor.)
const AUTH_PROBE_PATHS = ['/auth/jwt/login']

let onUnauthorized: (() => void) | null = null

/** Called once (AuthProvider) so an expired session sends the user back to Login. */
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler
}

// Single-flight refresh: a burst of 401s shares one /refresh call instead of
// stampeding the endpoint (and racing each other into reuse-revocation).
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null
  try {
    const res = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_URL}/auth/jwt/refresh`,
      { refresh_token: refreshToken },
    )
    await setToken(res.data.access_token, res.data.refresh_token)
    return res.data.access_token
  } catch {
    return null // refresh token expired/revoked → caller logs out
  }
}

api.interceptors.response.use(undefined, async (error) => {
  const status = error?.response?.status
  const original = error?.config
  const url: string = original?.url ?? ''
  if (status === 401 && original && !original._retry && !AUTH_PROBE_PATHS.some((p) => url.includes(p))) {
    original._retry = true
    refreshing = refreshing ?? refreshAccessToken()
    const fresh = await refreshing
    refreshing = null
    if (fresh) {
      original.headers = original.headers ?? {}
      original.headers.Authorization = `Bearer ${fresh}`
      return api(original) // replay the original request with the new token
    }
    onUnauthorized?.()
  }
  return Promise.reject(error)
})
