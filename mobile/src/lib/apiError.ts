export function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as any)?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
