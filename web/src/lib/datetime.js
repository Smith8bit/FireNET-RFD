
const THAI_DATE = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
})

const THAI_TIME = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
})

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

const THAI_DATETIME = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

const THAI_DAYTIME = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

export function formatEventTime(value) {
    return `${THAI_DATETIME.format(new Date(value))} น.`
}

export function formatLastSeen(value) {
    if (!value) return ''
    const dt = new Date(value)
    return isNaN(dt) ? '' : `${THAI_DAYTIME.format(dt)} น.`
}
