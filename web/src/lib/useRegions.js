import { useEffect, useState } from 'react'
import { apiFetch } from './shared'

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

export function useRegions() {
  const [data, setData] = useState(null)
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
