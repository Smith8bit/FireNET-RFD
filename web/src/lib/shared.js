export const API_URL = import.meta.env.VITE_API_URL ?? ''

export const PAGE_SIZE = 20

let refreshing = null

export function refreshSession() {
  return fetch(`${API_URL}/auth/cookie/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
}

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

export const USERNAME_PATTERN = '[A-Za-z0-9._@+-]+'
const USERNAME_RE = /^[A-Za-z0-9._@+-]{3,32}$/
export const isValidUsername = (v) => USERNAME_RE.test((v ?? '').trim())

export const matchesQuery = (item, fields, query) =>
  !query || fields.some((f) => (item[f] ?? '').toLowerCase().includes(query))

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

export const INPUT_CLS = 'w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm'
export const SELECT_CLS = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700'

export const THEAD_CLS = 'sticky top-0 bg-foreground z-10 [&_th]:shadow-[inset_0_-1px_0_#d1d5db]'
