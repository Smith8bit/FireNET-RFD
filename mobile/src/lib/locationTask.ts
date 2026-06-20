/**
 * Background location updates (expo-location + expo-task-manager).
 *
 * While an officer is online, their position is pushed to the backend on the
 * cadence the superuser configured — even when the app is backgrounded — via an
 * Android foreground service. Importing this module registers the task; the
 * AuthorizedLayout drives start/stop off the `online` flag.
 */
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { api, loadToken } from './api'

export const LOCATION_TASK = 'firenet-location-updates'

type LocationData = { locations?: Location.LocationObject[] }

TaskManager.defineTask<LocationData>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return
  // freshest fix in the batch; coords-only push (a heartbeat never flips `active`)
  const { coords } = data.locations[data.locations.length - 1]
  try {
    // headless task runs in a fresh JS context where the in-memory token is gone;
    // loadToken() rehydrates it from the keystore for the request interceptor
    await loadToken()
    await api.patch('/officers/me/location', {
      latitude: coords.latitude,
      longitude: coords.longitude,
    })
  } catch {
    // skip this tick; the next update retries
  }
})

/** Start (or restart with a new interval) background location updates. */
export async function startBackgroundLocation(intervalMs: number): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') return false
  // background grant lets updates continue when the app isn't foregrounded; the
  // foreground service keeps the task alive either way, so don't hard-fail on deny
  await Location.requestBackgroundPermissionsAsync().catch(() => {})

  if (await hasStarted()) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // Balanced (~100m) not High: the heartbeat only places an officer on the admin
    // map and gates province-level booking — 10m GPS is wasted battery here.
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    // 0 (time-only): a stationary officer must keep emitting or they cross the
    // 15-min online TTL and wrongly drop offline. Same reason pauses stay off.
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
  if (await hasStarted()) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}

async function hasStarted(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
