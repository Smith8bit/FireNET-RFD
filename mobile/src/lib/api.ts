// Shared axios client + JWT session management.
// Tokens are cached in module-level variables (not React state) so that any
// module — including background tasks (see lib/locationTask.ts) that run
// outside the component tree — can read/attach them synchronously.
import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL
if (!API_URL) {
  // Fail fast at import time rather than surfacing confusing network errors later.
  throw new Error('EXPO_PUBLIC_API_URL is not set — add it to mobile/.env')
}

const TOKEN_KEY = 'firenet_access_token'
const REFRESH_KEY = 'firenet_refresh_token'

export const api = axios.create({ baseURL: API_URL })

// In-memory mirrors of SecureStore, hydrated by loadToken(). Kept separate
// from SecureStore so reads (getToken/getRefreshToken) can stay synchronous.
let accessToken: string | null = null
let refreshToken: string | null = null

/**
 * Hydrates the in-memory token cache from SecureStore.
 * Must be called once at app startup (and inside the background location
 * task, which runs in its own JS context with no shared module state).
 * @returns the loaded access token, or null if the user was never signed in.
 */
export async function loadToken(): Promise<string | null> {
  accessToken = await SecureStore.getItemAsync(TOKEN_KEY)
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY)
  return accessToken
}

/** Synchronous read of the cached access token (null if signed out / not yet loaded). */
export function getToken(): string | null {
  return accessToken
}

/**
 * Persists a new access token (and optionally a rotated refresh token) to
 * both the in-memory cache and SecureStore.
 * @param access - new JWT access token.
 * @param refresh - new refresh token; omitted when only the access token was rotated.
 */
export async function setToken(access: string, refresh?: string): Promise<void> {
  accessToken = access
  await SecureStore.setItemAsync(TOKEN_KEY, access)
  if (refresh !== undefined) {
    refreshToken = refresh
    await SecureStore.setItemAsync(REFRESH_KEY, refresh)
  }
}

/** Synchronous read of the cached refresh token. */
export function getRefreshToken(): string | null {
  return refreshToken
}

/** Clears the session from memory and SecureStore (used on sign-out / forced logout). */
export async function clearToken(): Promise<void> {
  accessToken = null
  refreshToken = null
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  await SecureStore.deleteItemAsync(REFRESH_KEY)
}

// Attach the bearer token to every outgoing request when one is cached.
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// A 401 from the login endpoint itself means "wrong credentials", not "expired
// session" — excluding it here prevents an infinite refresh loop on bad login.
const AUTH_PROBE_PATHS = ['/auth/jwt/login']

// Injected by AuthProvider at runtime. Kept as a settable callback (rather than
// importing AuthProvider directly) to avoid a circular import between the
// low-level api client and the React auth context that depends on it.
let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler
}

// Dedupes concurrent refresh attempts: if several requests 401 at once, only
// one network call to /auth/jwt/refresh is made and all of them await it.
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
    // Refresh token itself is invalid/expired — caller treats this as "must re-login".
    return null
  }
}

// Global 401 handler: transparently refreshes the access token and retries
// the original request exactly once; if refresh fails, forces logout via the
// callback registered through setOnUnauthorized.
api.interceptors.response.use(undefined, async (error) => {
  const status = error?.response?.status
  const original = error?.config
  const url: string = original?.url ?? ''
  if (status === 401 && original && !original._retry && !AUTH_PROBE_PATHS.some((p) => url.includes(p))) {
    original._retry = true // guards against retry-loops if the refreshed token is also rejected
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
