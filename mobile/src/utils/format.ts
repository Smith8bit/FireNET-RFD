/**
 * Formats a fire's detection timestamp for display to Thai-speaking officers.
 * @param iso - ISO 8601 datetime string, as returned by the backend (assumed
 * valid/parseable; invalid input yields `Date`'s "Invalid Date" text).
 * @returns a localized `th-TH` string, e.g. "7 ก.ค. 2026 14:30".
 */
export function formatDetectedAt(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
