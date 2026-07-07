import { useEffect, useState } from 'react'
import { apiFetch } from './shared'

// The region hierarchy is effectively static per session, so it's fetched once and
// shared across every component via a module-level promise cache. Caching the *promise*
// (not just the result) also de-duplicates concurrent first-mount requests.
let cache = null

// Invalidate the cache so the next useRegions() re-fetches — called on logout, since
// a different user may have a different region scope.
export function clearRegionsCache() {
  cache = null
}

/**
 * Fetch the full region tree and derive a sorted province list.
 * @returns {Promise<{regions: object[], provinces: object[]}>}
 * @throws {Error} On non-2xx responses (HTTP <status>).
 * @remarks Provinces are copied (.slice()) before sorting to avoid mutating `regions`,
 *   and sorted with Thai collation ('th') for correct alphabetical order in dropdowns.
 */
async function fetchRegions() {
  const res = await apiFetch('/regions')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const regions = await res.json()
  const provinces = regions
    .filter((r) => r.level === 'province')
    .slice()
    .sort((a, b) => a.name_th.localeCompare(b.name_th, 'th'))
  return { regions, provinces }
}

/**
 * Hook giving components the cached region data with loading/error handling.
 * @returns {{regions: object[]|null, provinces: object[]|null, error: Error|null}}
 *   regions/provinces are null until the fetch resolves.
 */
export function useRegions() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false // guards against setState after unmount (avoids React warning).
    // Reuse the shared promise; on failure, null the cache so a later mount can retry.
    cache = cache ?? fetchRegions().catch((e) => { cache = null; throw e })
    cache.then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [])

  return { regions: data?.regions ?? null, provinces: data?.provinces ?? null, error }
}
