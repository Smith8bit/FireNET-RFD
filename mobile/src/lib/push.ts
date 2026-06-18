/**
 * Firebase Cloud Messaging integration (Direct FCM via @react-native-firebase/messaging).
 *
 * Uses the v22 MODULAR API (getMessaging/onMessage/getToken/... as standalone
 * functions taking the Messaging instance first) — the namespaced
 * `messaging().onMessage(...)` form is deprecated and warns at runtime.
 *
 * Everything here is GUARDED: the messaging module is loaded lazily and any
 * failure (native module not present, no google-services.json, permission
 * denied) degrades to a no-op. That keeps the current dev build working before
 * the native rebuild — see mobile/PUSH_SETUP.md for the steps to go live.
 */
import { PermissionsAndroid, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { api } from './api'

type RemoteMessage = {
  data?: Record<string, string>
  notification?: { title?: string; body?: string }
}
type Messaging = any
// the @react-native-firebase/messaging module namespace, which carries the
// modular functions (getMessaging, onMessage, getToken, AuthorizationStatus, …)
type Fcm = any

/** Android channel for appointment alerts; HIGH importance gives a heads-up banner. */
const ANDROID_CHANNEL_ID = 'appointments'

// FCM does NOT display a notification while the app is foregrounded — it only
// hands the message to onMessage. We re-present it as a local notification, and
// this handler is what lets that local notification surface over the open app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

let _channelReady = false
/** Create the Android notification channel once (no-op on iOS / on repeat). */
async function ensureAndroidChannel(): Promise<void> {
  if (_channelReady || Platform.OS !== 'android') return
  _channelReady = true
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'การมอบหมายงาน',
      importance: Notifications.AndroidImportance.HIGH,
    })
  } catch {
    _channelReady = false // allow a later retry
  }
}

/** Present an incoming FCM message as a local notification (foreground only). */
async function presentLocal(m: RemoteMessage): Promise<void> {
  try {
    await ensureAndroidChannel()
    await Notifications.scheduleNotificationAsync({
      content: {
        title: m.notification?.title ?? 'ได้รับมอบหมายงานใหม่',
        body: m.notification?.body ?? '',
        data: m.data ?? {},
      },
      trigger: null, // null = deliver immediately
    })
  } catch {
    // display is best-effort; the in-app refresh still happens via onAppointment
  }
}

/**
 * Ask for the OS notification permission up front — independent of FCM and of
 * login state — so the dialog appears at app launch rather than only after a
 * verified field officer signs in. Safe to call on every launch: the OS shows
 * the dialog only the first time and resolves immediately thereafter.
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

let _fcm: Fcm | null | undefined // undefined = not yet attempted
let _messaging: Messaging | null

/** Lazily resolve { fcm module, messaging instance }, or null if the native module is absent. */
function getFcm(): { fcm: Fcm; messaging: Messaging } | null {
  if (_fcm === undefined) {
    try {
      // require (not import) so a missing native module fails here, not at bundle load
      _fcm = require('@react-native-firebase/messaging')
      _messaging = _fcm.getMessaging() // modular: default app
    } catch {
      console.log('[push] @react-native-firebase/messaging unavailable; push disabled')
      _fcm = null
      _messaging = null
    }
  }
  return _fcm && _messaging ? { fcm: _fcm, messaging: _messaging } : null
}

async function ensurePermission(fcm: Fcm, messaging: Messaging): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // POST_NOTIFICATIONS is runtime-requested on Android 13+ (API 33); a no-op below that
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        )
        return res === PermissionsAndroid.RESULTS.GRANTED
      }
      return true
    }
    const status = await fcm.requestPermission(messaging)
    const AuthorizationStatus = fcm.AuthorizationStatus
    return (
      status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL
    )
  } catch {
    return false
  }
}

/** Request permission, fetch the FCM token, and register it with the backend. */
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
    console.log('[push] token registration failed (will retry next session)', e)
  }
}

/** Best-effort: remove this device's token server-side, then locally. Used on sign-out. */
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
    // ignore — sign-out proceeds regardless
  }
}

export type AppointmentHandler = (fireId: string | null) => void

/**
 * Wire foreground + tap handlers. `onAppointment(fireId)` fires when a
 * fire-appointment notification is received in the foreground or tapped to
 * open the app. Returns an unsubscribe function.
 */
export function setupNotificationHandlers(onAppointment: AppointmentHandler): () => void {
  const ctx = getFcm()
  if (!ctx) return () => {}
  const { fcm, messaging } = ctx

  void ensureAndroidChannel()

  const isAppointment = (m: RemoteMessage | null | undefined) =>
    m?.data?.type === 'fire_appointment'

  const unsubMessage = fcm.onMessage(messaging, async (m: RemoteMessage) => {
    // foreground: FCM won't show a banner itself, so present one locally
    await presentLocal(m)
    if (isAppointment(m)) onAppointment(m.data?.fire_id ?? null)
  })
  const unsubOpened = fcm.onNotificationOpenedApp(messaging, (m: RemoteMessage) => {
    if (isAppointment(m)) onAppointment(m.data?.fire_id ?? null)
  })
  const unsubRefresh = fcm.onTokenRefresh(messaging, (token: string) => {
    api.put('/officers/me/push-token', { token, platform: Platform.OS }).catch(() => {})
  })

  // app opened from a quit state by tapping the notification
  fcm
    .getInitialNotification(messaging)
    .then((m: RemoteMessage | null) => {
      if (isAppointment(m)) onAppointment(m?.data?.fire_id ?? null)
    })
    .catch(() => {})

  return () => {
    unsubMessage?.()
    unsubOpened?.()
    unsubRefresh?.()
  }
}
