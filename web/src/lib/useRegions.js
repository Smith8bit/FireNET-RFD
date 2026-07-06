import { useEffect, useState } from 'react'
import { apiFetch } from './shared'

// /regions and /regions/provinces apply the identical viewer-scoped ltree filter
// (backend/app/router/regions.py) — provinces are just the province-level subset
// of regions, sorted by Thai name. One fetch + client-side filter covers both,
// and the promise is cached so every page that needs them shares one request.
let cache = null

export function clearRegionsCache() {
  cache = null
}

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

// shared, cached region/province lookup — replaces each page fetching its own copy
export function useRegions() {
  const [data, setData] = useState(null) // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    cache = cache ?? fetchRegions().catch((e) => { cache = null; throw e })
    cache.then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [])

  return { regions: data?.regions ?? null, provinces: data?.provinces ?? null, error }
}
