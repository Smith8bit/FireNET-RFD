export const API_URL = import.meta.env.VITE_API_URL ?? ''

export const ERROR_MESSAGES = {
  email_taken: 'อีเมลนี้ถูกใช้งานแล้ว',
  invalid_email: 'รูปแบบอีเมลไม่ถูกต้อง',
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
