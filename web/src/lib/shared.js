export const API_URL = import.meta.env.VITE_API_URL ?? ''

// The access cookie is short-lived; when it expires the server 401s. apiFetch
// transparently posts to /auth/cookie/refresh (which swaps the httpOnly refresh
// cookie for a fresh access cookie) and replays the request once. A single-flight
// guard means a burst of 401s shares one refresh instead of stampeding it.
let refreshing = null

export function refreshSession() {
  return fetch(`${API_URL}/auth/cookie/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
}

// Registered by the auth store so a dead session (refresh token also expired)
// drops the user back to the login screen instead of silently erroring.
let onSessionExpired = null
export function setOnSessionExpired(fn) {
  onSessionExpired = fn
}

export async function apiFetch(path, init = {}) {
  const opts = { credentials: 'include', ...init }
  let res = await fetch(`${API_URL}${path}`, opts)
  if (res.status === 401 && !path.startsWith('/auth/')) {
    refreshing = refreshing ?? refreshSession()
    const ok = await refreshing
    refreshing = null
    if (ok) {
      res = await fetch(`${API_URL}${path}`, opts)
    } else {
      onSessionExpired?.()
    }
  }
  return res
}

// Mirror the backend Username rule (backend/app/database/schemas.py): 3–32 chars
// of letters, digits, and . _ @ + - — validate client-side so a bad value is
// caught before the round-trip. HTML `pattern` omits the {3,32} length (minLength
// /maxLength cover that), the regex below checks the whole thing.
export const USERNAME_PATTERN = '[A-Za-z0-9._@+-]+'
const USERNAME_RE = /^[A-Za-z0-9._@+-]{3,32}$/
export const isValidUsername = (v) => USERNAME_RE.test((v ?? '').trim())

export const ERROR_MESSAGES = {
  username_taken: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว',
  invalid_username: 'ชื่อผู้ใช้ต้องมี 3-32 ตัว ใช้ได้เฉพาะ ตัวอักษร ตัวเลข . _ @ + -',
  weak_password: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
  out_of_scope: 'อยู่นอกพื้นที่รับผิดชอบของคุณ',
  nothing_to_update: 'ไม่มีการเปลี่ยนแปลง',
  invalid_region: 'กรุณาเลือกพื้นที่ให้ถูกต้อง',
  forbidden: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
}

export const REGION_LEVEL_TH = { national: 'ประเทศ', regional: 'ภาค', province: 'จังหวัด' }

export const errorText = (code) =>
  ERROR_MESSAGES[code] ?? ('เกิดข้อผิดพลาด: ' + (code ?? 'unknown'))

// shared field styling so every form in the management tabs looks identical
export const INPUT_CLS = 'w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm'
export const SELECT_CLS = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700'
