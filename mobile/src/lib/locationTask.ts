import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { api, loadToken } from './api'

export const LOCATION_TASK = 'firenet-location-updates'

type LocationData = { locations?: Location.LocationObject[] }

TaskManager.defineTask<LocationData>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return
  const { coords } = data.locations[data.locations.length - 1]
  try {
    await loadToken()
    await api.patch('/officers/me/location', {
      latitude: coords.latitude,
      longitude: coords.longitude,
    })
  } catch {
  }
})

export async function startBackgroundLocation(intervalMs: number): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') return false
  await Location.requestBackgroundPermissionsAsync().catch(() => {})

  if (await hasStarted()) return true
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'กำลังแชร์ตำแหน่ง',
      notificationBody: 'แอปกำลังส่งตำแหน่งของคุณขณะออนไลน์',
    },
  })
  return true
}

export async function stopBackgroundLocation(): Promise<void> {
  try {
    if (await hasStarted()) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  } catch {}
}

async function hasStarted(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
