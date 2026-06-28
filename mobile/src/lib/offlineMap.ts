/**
 * Offline map tiles for the officer's home region (MapLibre OfflineManager).
 *
 * The map style ([base.json]) pulls raster tiles live from Google's servers, so
 * with no signal the map is blank outside MapLibre's ambient cache. This lets the
 * officer pre-download their region from Settings so it renders offline in the field.
 */
import type { Home } from '@/providers/AuthProvider'
import { OfflineManager } from '@maplibre/maplibre-react-native'

const API_URL = process.env.EXPO_PUBLIC_API_URL

// Box half-width in degrees (~0.4° ≈ 45 km at Thai latitudes) and a capped zoom
// range keep the tile count sane (~2k). ponytail: fixed box around the home
// center — the officer's actual region polygon isn't in the profile. If areas are
// larger or need street-level zoom, widen HALF_DEG / raise MAX_ZOOM and watch the
// tile count. MUST be verified on-device (Google-tile caching + count limits).
const HALF_DEG = 0.4
const MIN_ZOOM = 8
const MAX_ZOOM = 14

// createPack takes mapStyle as a URL fetched through MapLibre's own HTTP stack
// (only http(s) — inline JSON and file:// both fail to parse). The backend serves
// the same raster style publicly at /map-style.json; the downloader reads it to
// find the source, then caches the Google tiles in-bounds by URL — the same URLs
// MapView requests, so they serve from cache when offline.
const mapStyle = `${API_URL}/map-style.json`

/** Download (or refresh) offline tiles for the officer's home region. */
export async function downloadHomePack(
  home: Home,
  onProgress: (percent: number) => void,
): Promise<void> {
  // we only ever keep one pack; drop any prior one so a relocated officer
  // re-downloads their new region instead of stacking stale tiles
  const existing = await OfflineManager.getPacks()
  await Promise.all(existing.map((p) => OfflineManager.deletePack(p.id)))

  const bounds: [number, number, number, number] = [
    home.lng - HALF_DEG,
    home.lat - HALF_DEG,
    home.lng + HALF_DEG,
    home.lat + HALF_DEG,
  ]

  await new Promise<void>((resolve, reject) => {
    OfflineManager.createPack(
      { mapStyle, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
      (_pack, status) => {
        onProgress(status.percentage)
        if (status.state === 'complete') resolve()
      },
      (_pack, err) => reject(new Error(err.message)),
    ).catch(reject) // pack creation itself failed (not just a download tick)
  })
}

/** Total downloaded bytes of the home pack, or null if none has been downloaded. */
export async function homePackSize(): Promise<number | null> {
  const packs = await OfflineManager.getPacks()
  if (packs.length === 0) return null
  const status = await packs[0].status()
  return status.completedResourceSize
}
