/**
 * Extracts a human-readable message from a FastAPI-style error response.
 * The backend returns `{ detail: string }` for known/handled errors, but
 * unhandled errors (network failures, 500s) won't have that shape — hence
 * the `unknown` input, defensive `any` cast, and required fallback string.
 * @param e - the caught error (typically an AxiosError, but not assumed to be).
 * @param fallback - message to show when no server-provided detail exists.
 * @returns the server's detail string, or `fallback` if absent/non-string.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as any)?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
