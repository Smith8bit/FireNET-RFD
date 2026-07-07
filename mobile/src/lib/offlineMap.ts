import type { Home } from '@/providers/AuthProvider'
import { OfflineManager } from '@maplibre/maplibre-react-native'

const API_URL = process.env.EXPO_PUBLIC_API_URL

const HALF_DEG = 0.4
const MIN_ZOOM = 8
const MAX_ZOOM = 14

const mapStyle = `${API_URL}/map-style.json`

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

export async function homePackSize(): Promise<number | null> {
  const packs = await OfflineManager.getPacks()
  if (packs.length === 0) return null
  const status = await packs[0].status()
  return status.completedResourceSize
}
