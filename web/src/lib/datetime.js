// Thai-localized date/time formatting helpers. Intl formatters are created once at
// module load and reused (constructing them is relatively expensive), giving Buddhist-
// era years and Thai month names for free. 'น.' is the Thai abbreviation appended to
// clock times ("นาฬิกา" / o'clock).

const THAI_DATE = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
})

const THAI_TIME = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
})

/**
 * Combine separate date/time strings into a Date, tolerating a missing time.
 * @param {string} dateStr  ISO date 'YYYY-MM-DD'; falsy => null (no date to parse).
 * @param {string} [timeStr]  'HH:MM'; defaults to midnight when absent.
 * @returns {Date|null} Parsed Date, or null if input is missing or unparseable.
 */
export function parseDetected(dateStr, timeStr) {
    if (!dateStr) return null
    const dt = new Date(`${dateStr}T${timeStr || '00:00'}`)
    return isNaN(dt) ? null : dt // isNaN(Date) catches invalid strings ("Invalid Date").
}

/**
 * @returns {string} Thai-formatted date, or '-' placeholder when there's no valid date.
 */
export function formatDate(dateStr, timeStr) {
    const dt = parseDetected(dateStr, timeStr)
    return dt ? THAI_DATE.format(dt) : '-'
}

/**
 * @returns {string} Thai-formatted time with the 'น.' suffix, or '' when invalid.
 */
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

/**
 * Format an event timestamp (date + time). Assumes `value` is a valid parseable date;
 * used for audit/history entries where the value is server-generated and trusted.
 * @param {string|number|Date} value
 * @returns {string} Full Thai date-time with 'น.' suffix.
 */
export function formatEventTime(value) {
    return `${THAI_DATETIME.format(new Date(value))} น.`
}

/**
 * Format a "last seen" timestamp (day + time, no year), for recent activity displays.
 * @param {string|number|Date} [value]
 * @returns {string} Thai day-time with 'น.' suffix, or '' when value is missing/invalid.
 */
export function formatLastSeen(value) {
    if (!value) return ''
    const dt = new Date(value)
    return isNaN(dt) ? '' : `${THAI_DAYTIME.format(dt)} น.`
}
