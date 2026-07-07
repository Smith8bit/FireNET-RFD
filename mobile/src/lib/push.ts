import { PermissionsAndroid, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { api } from './api'

type RemoteMessage = {
  data?: Record<string, string>
  notification?: { title?: string; body?: string }
}
type Messaging = any
type Fcm = any

const ANDROID_CHANNEL_ID = 'appointments'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

let _channelReady = false
async function ensureAndroidChannel(): Promise<void> {
  if (_channelReady || Platform.OS !== 'android') return
  _channelReady = true
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'การมอบหมายงาน',
      importance: Notifications.AndroidImportance.HIGH,
    })
  } catch {
    _channelReady = false
  }
}

async function presentLocal(m: RemoteMessage): Promise<void> {
  try {
    await ensureAndroidChannel()
    await Notifications.scheduleNotificationAsync({
      content: {
        title: m.notification?.title ?? 'ได้รับมอบหมายงานใหม่',
        body: m.notification?.body ?? '',
        data: m.data ?? {},
      },
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    })
  } catch {
  }
}

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

let _fcm: Fcm | null | undefined
let _messaging: Messaging | null

function getFcm(): { fcm: Fcm; messaging: Messaging } | null {
  if (_fcm === undefined) {
    try {
      _fcm = require('@react-native-firebase/messaging')
      _messaging = _fcm.getMessaging()
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

export function setupNotificationHandlers(
  onAppointment: AppointmentHandler,
  onCancellation?: AppointmentHandler,
): () => void {
  const ctx = getFcm()
  if (!ctx) return () => {}
  const { fcm, messaging } = ctx

  void ensureAndroidChannel()

  const route = (m: RemoteMessage | null | undefined) => {
    const type = m?.data?.type
    const fireId = m?.data?.fire_id ?? null
    if (type === 'fire_appointment') onAppointment(fireId)
    else if (type === 'fire_cancelled') onCancellation?.(fireId)
  }

  const unsubMessage = fcm.onMessage(messaging, async (m: RemoteMessage) => {
    await presentLocal(m)
    route(m)
  })
  const unsubOpened = fcm.onNotificationOpenedApp(messaging, (m: RemoteMessage) => route(m))
  const unsubRefresh = fcm.onTokenRefresh(messaging, (token: string) => {
    api.put('/officers/me/push-token', { token, platform: Platform.OS }).catch(() => {})
  })

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
