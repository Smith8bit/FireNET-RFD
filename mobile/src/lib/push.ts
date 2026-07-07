// Push notifications for fire "appointment" assignments/cancellations, built
// on Firebase Cloud Messaging (FCM). The FCM native module is optional at
// runtime (e.g. unavailable in Expo Go or a build without google-services),
// so every FCM-touching function degrades to a no-op instead of throwing.
import { PermissionsAndroid, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { api } from './api'

type RemoteMessage = {
  data?: Record<string, string>
  notification?: { title?: string; body?: string }
}
// Typed as `any`: these come from a lazily `require()`-d optional native
// module (see getFcm) whose types aren't available when the package is absent.
type Messaging = any
type Fcm = any

const ANDROID_CHANNEL_ID = 'appointments'

// Controls how notifications are presented while the app is in the foreground
// (by default Expo suppresses the OS banner unless configured here).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

// Android 8+ requires notifications to be posted to a pre-created channel;
// the module-level flag ensures this only runs once per process.
let _channelReady = false
async function ensureAndroidChannel(): Promise<void> {
  if (_channelReady || Platform.OS !== 'android') return
  _channelReady = true
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'การมอบหมายงาน', // "Task assignments" — user-facing channel name in system settings
      importance: Notifications.AndroidImportance.HIGH,
    })
  } catch {
    _channelReady = false // allow a retry on the next call since setup failed
  }
}

// FCM data-only/background messages don't auto-display a system notification,
// so one must be scheduled manually via expo-notifications.
async function presentLocal(m: RemoteMessage): Promise<void> {
  try {
    await ensureAndroidChannel()
    await Notifications.scheduleNotificationAsync({
      content: {
        title: m.notification?.title ?? 'ได้รับมอบหมายงานใหม่', // "New task assigned" fallback
        body: m.notification?.body ?? '',
        data: m.data ?? {},
      },
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    })
  } catch {
    // Best-effort UI feedback; a failure here shouldn't block message routing.
  }
}

/**
 * Requests OS-level notification permission. Independent of FCM availability
 * — local notifications can still work without the push transport.
 * @returns true if permission is (or becomes) granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    await ensureAndroidChannel()
    const current = await Notifications.getPermissionsAsync()
    if (current.granted) return true
    const requested = await Notifications.requestPermissionsAsync()
    return requested.granted
  } catch {
    return false
  }
}

// Lazily-resolved, memoized FCM handle. `_fcm === undefined` means "not yet
// attempted"; `null` means "attempted and unavailable" — distinguishing the
// two avoids re-running the (possibly slow/throwing) require() on every call.
let _fcm: Fcm | null | undefined
let _messaging: Messaging | null

function getFcm(): { fcm: Fcm; messaging: Messaging } | null {
  if (_fcm === undefined) {
    try {
      _fcm = require('@react-native-firebase/messaging')
      _messaging = _fcm.getMessaging()
    } catch {
      // Expected in environments without the native Firebase module linked.
      console.log('[push] @react-native-firebase/messaging unavailable; push disabled')
      _fcm = null
      _messaging = null
    }
  }
  return _fcm && _messaging ? { fcm: _fcm, messaging: _messaging } : null
}

/** Requests the platform-specific permission needed to receive push notifications. */
async function ensurePermission(fcm: Fcm, messaging: Messaging): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Runtime POST_NOTIFICATIONS permission only exists from API 33 (Android 13)
      // onward; earlier versions grant notification access at install time.
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        )
        return res === PermissionsAndroid.RESULTS.GRANTED
      }
      return true
    }
    // iOS: FCM's own permission API; PROVISIONAL counts as granted (quiet,
    // non-intrusive delivery to Notification Center without an alert prompt).
    const status = await fcm.requestPermission(messaging)
    const AuthorizationStatus = fcm.AuthorizationStatus
    return (
      status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL
    )
  } catch {
    return false
  }
}

/**
 * Requests permission and registers this device's FCM token with the
 * backend so it can receive appointment push notifications. No-op if FCM
 * is unavailable or permission is denied — failures are logged, not thrown,
 * since callers (e.g. sign-in) shouldn't fail because push setup failed.
 */
export async function registerPushToken(): Promise<void> {
  const ctx = getFcm()
  if (!ctx) return
  const { fcm, messaging } = ctx
  try {
    if (!(await ensurePermission(fcm, messaging))) {
      console.log('[push] notification permission not granted')
      return
    }
    const token: string = await fcm.getToken(messaging)
    if (!token) return
    await api.put('/officers/me/push-token', { token, platform: Platform.OS })
    console.log('[push] device token registered')
  } catch (e) {
    // Registration will simply be retried the next time the officer signs in.
    console.log('[push] token registration failed (will retry next session)', e)
  }
}

/**
 * Removes this device's token from the backend and invalidates it locally
 * on sign-out, so a signed-out device stops receiving pushes for the account.
 */
export async function unregisterPushToken(): Promise<void> {
  const ctx = getFcm()
  if (!ctx) return
  const { fcm, messaging } = ctx
  try {
    const token: string = await fcm.getToken(messaging)
    if (token) {
      await api.delete('/officers/me/push-token', { data: { token } }).catch(() => {})
    }
    await fcm.deleteToken(messaging).catch(() => {})
  } catch {
  }
}

export type AppointmentHandler = (fireId: string | null) => void

/**
 * Wires up all FCM listeners for the lifetime of the caller (typically a
 * top-level effect): foreground messages, notification taps, silent token
 * refresh, and the notification that launched the app from a killed state.
 * @param onAppointment - called with the assigned fire's id when a new
 * appointment notification is received/tapped/launches the app.
 * @param onCancellation - called the same way when an appointment is cancelled.
 * @returns an unsubscribe function that removes all registered listeners;
 * returns a no-op function if FCM is unavailable so callers can unconditionally
 * call the cleanup function without checking for availability first.
 */
export function setupNotificationHandlers(
  onAppointment: AppointmentHandler,
  onCancellation?: AppointmentHandler,
): () => void {
  const ctx = getFcm()
  if (!ctx) return () => {}
  const { fcm, messaging } = ctx

  void ensureAndroidChannel()

  // Single dispatcher shared by all entry points (foreground message, tap,
  // cold-start) so routing logic for the payload only lives in one place.
  const route = (m: RemoteMessage | null | undefined) => {
    const type = m?.data?.type
    const fireId = m?.data?.fire_id ?? null
    if (type === 'fire_appointment') onAppointment(fireId)
    else if (type === 'fire_cancelled') onCancellation?.(fireId)
  }

  // Foreground: FCM delivers the message silently, so a local notification
  // must be shown manually before routing it.
  const unsubMessage = fcm.onMessage(messaging, async (m: RemoteMessage) => {
    await presentLocal(m)
    route(m)
  })
  // Background/tapped: OS already displayed the notification; just route it.
  const unsubOpened = fcm.onNotificationOpenedApp(messaging, (m: RemoteMessage) => route(m))
  // FCM tokens can rotate at any time; keep the backend in sync silently.
  const unsubRefresh = fcm.onTokenRefresh(messaging, (token: string) => {
    api.put('/officers/me/push-token', { token, platform: Platform.OS }).catch(() => {})
  })

  // Cold start: app was killed and opened by tapping a notification — FCM's
  // event listeners above wouldn't have fired in time to catch this case.
  fcm
    .getInitialNotification(messaging)
    .then((m: RemoteMessage | null) => route(m))
    .catch(() => {})

  return () => {
    unsubMessage?.()
    unsubOpened?.()
    unsubRefresh?.()
  }
}
