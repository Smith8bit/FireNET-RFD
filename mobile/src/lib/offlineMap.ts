// Downloads a bounded region of map tiles for offline use around an
// officer's assigned "home" location, so the map remains usable without
// connectivity in the field.
import type { Home } from '@/providers/AuthProvider'
import { OfflineManager } from '@maplibre/maplibre-react-native'

const API_URL = process.env.EXPO_PUBLIC_API_URL

// Bounding-box half-width in degrees (~44km), centered on `home` — a fixed
// square region rather than the whole province keeps the download small.
const HALF_DEG = 0.4
const MIN_ZOOM = 8
const MAX_ZOOM = 14 // caps storage/tile count; 14 is street-level detail, sufficient for field navigation

const mapStyle = `${API_URL}/map-style.json`

/**
 * Downloads the offline tile pack for `home`, replacing any previously
 * downloaded pack (this app supports only one cached region at a time, to
 * bound on-device storage — otherwise stale packs from prior assignments
 * would accumulate indefinitely).
 * @param home - center point (and implicit region) to download tiles for.
 * @param onProgress - called with 0-100 as tiles download.
 * @throws if the underlying MapLibre pack creation fails.
 */
export async function downloadHomePack(
  home: Home,
  onProgress: (percent: number) => void,
): Promise<void> {
  const existing = await OfflineManager.getPacks()
  await Promise.all(existing.map((p) => OfflineManager.deletePack(p.id)))

  const bounds: [number, number, number, number] = [
    home.lng - HALF_DEG,
    home.lat - HALF_DEG,
    home.lng + HALF_DEG,
    home.lat + HALF_DEG,
  ]

  // MapLibre's createPack uses a callback API; wrap it in a Promise so
  // callers can await completion while still receiving progress updates.
  await new Promise<void>((resolve, reject) => {
    OfflineManager.createPack(
      { mapStyle, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
      (_pack, status) => {
        onProgress(status.percentage)
        if (status.state === 'complete') resolve()
      },
      (_pack, err) => reject(new Error(err.message)),
    ).catch(reject)
  })
}

/**
 * @returns the downloaded pack's size in bytes, or null if no offline pack
 * has been downloaded yet. Only ever inspects the first pack since at most
 * one is retained (see downloadHomePack).
 */
export async function homePackSize(): Promise<number | null> {
  const packs = await OfflineManager.getPacks()
  if (packs.length === 0) return null
  const status = await packs[0].status()
  return status.completedResourceSize
}
