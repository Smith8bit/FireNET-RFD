// Pull a human-readable message out of an axios error's `{ detail }` body, falling
// back to a caller-supplied default when the server didn't send a string detail.
// Shared by the screens that surface raw backend validation messages verbatim.
export function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as any)?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
