// Shared Thai-friendly date/time formatting for fire detection timestamps.
// Buddhist year + short Thai month, e.g. "12 มิ.ย. 69" and "14:30 น.".

const THAI_DATE = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
})

const THAI_TIME = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
})

// dateStr: "2026-06-12", timeStr: "14:30" -> Date | null
export function parseDetected(dateStr, timeStr) {
    if (!dateStr) return null
    const dt = new Date(`${dateStr}T${timeStr || '00:00'}`)
    return isNaN(dt) ? null : dt
}

export function formatDate(dateStr, timeStr) {
    const dt = parseDetected(dateStr, timeStr)
    return dt ? THAI_DATE.format(dt) : '-'
}

export function formatTime(dateStr, timeStr) {
    const dt = parseDetected(dateStr, timeStr)
    return dt ? `${THAI_TIME.format(dt)} น.` : ''
}
