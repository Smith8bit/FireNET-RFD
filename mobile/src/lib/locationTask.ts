// Background location tracking for on-duty field officers: keeps the
// officer's last-known position on the server even while the app is
// backgrounded or the device is locked, so dispatch/mapping stays accurate.
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { api, loadToken } from './api'

// Task name registered with the OS scheduler; must be a stable string since
// the OS (not this module) invokes the task by name after app restarts/kills.
export const LOCATION_TASK = 'firenet-location-updates'

type LocationData = { locations?: Location.LocationObject[] }

// Defined at module scope (not inside a component) because TaskManager tasks
// must be registered synchronously on import — Expo re-runs this file in a
// headless JS context when the OS wakes the app purely to deliver a location
// update, so there is no guarantee any React tree has mounted.
TaskManager.defineTask<LocationData>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return
  // Only the most recent sample matters; older queued points are discarded.
  const { coords } = data.locations[data.locations.length - 1]
  try {
    // The headless context has no in-memory token cache of its own, so the
    // secure-storage-backed token must be reloaded before each call.
    await loadToken()
    await api.patch('/officers/me/location', {
      latitude: coords.latitude,
      longitude: coords.longitude,
    })
  } catch {
    // Best-effort: a dropped update will be superseded by the next tick, and
    // a task that throws can be killed/backed-off by the OS scheduler.
  }
})

/**
 * Requests location permissions and starts background tracking.
 * @param intervalMs - minimum time between location updates sent to the server.
 * @returns true if tracking is running (or already was); false if the user
 * denied the required foreground permission (background permission is
 * best-effort and not required to proceed, since some platforms/OS versions
 * still deliver updates while foregrounded without it).
 */
export async function startBackgroundLocation(intervalMs: number): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') return false
  await Location.requestBackgroundPermissionsAsync().catch(() => {})

  if (await hasStarted()) return true // idempotent: avoid double-registering the task
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    distanceInterval: 0, // report on the time interval regardless of movement distance
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      // Android requires a persistent notification while tracking in the
      // background; copy is Thai since the app's user base is Thai officers.
      notificationTitle: 'กำลังแชร์ตำแหน่ง',
      notificationBody: 'แอปกำลังส่งตำแหน่งของคุณขณะออนไลน์',
    },
  })
  return true
}

/** Stops background tracking if it is currently running; no-op otherwise. */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    if (await hasStarted()) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  } catch {}
}

async function hasStarted(): Promise<boolean> {
  // hasStartedLocationUpdatesAsync can throw if the task was never
  // registered in this process yet; treat that the same as "not started".
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
