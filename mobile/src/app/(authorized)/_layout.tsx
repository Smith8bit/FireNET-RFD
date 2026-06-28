import { api } from '@/lib/api'
import { startBackgroundLocation, stopBackgroundLocation } from '@/lib/locationTask'
import { setupNotificationHandlers } from '@/lib/push'
import { colors, fonts } from '@/lib/theme'
import { useAuthSession } from '@/providers/AuthProvider'
import { useFireStore } from '@/stores/fireStore'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { Redirect, Tabs, router } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, AppState, Pressable, View } from 'react-native'

const DEFAULT_POLL_MIN = 5
const MIN_POLL_MIN = 1

export default function AuthorizedLayout() {
  const { user, isLoading } = useAuthSession()
  const online = useFireStore((s) => s.online)
  const pushLocation = useFireStore((s) => s.pushLocation)
  const loadStatus = useFireStore((s) => s.loadStatus)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const loadFires = useFireStore((s) => s.loadFires)

  // the server keeps the online flag across app restarts; restore it
  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // an appointment push (foreground or tapped) → refresh the reserved fire and
  // surface it. Mobile is REST-only, so the push is how an officer learns of a
  // new appointment; the Firespot tab then shows the fetched fire.
  useEffect(() => {
    const unsubscribe = setupNotificationHandlers(
      () => {
        loadReservedFire()
        loadFires()
        router.navigate('/(authorized)/Firespot')
      },
      // cancellation: the booking was released — re-fetch (now returns no fire) so
      // the Firespot screen falls back to its default "no reserved fire" state
      () => {
        loadReservedFire()
        loadFires()
      },
    )
    return unsubscribe
  }, [loadReservedFire, loadFires])

  // While online, push the officer's position immediately, then keep pushing in
  // the background on the superuser-configured cadence (floor 1 min, default 5).
  // Coords-only (no `active`): going offline is owned solely by the toggle.
  useEffect(() => {
    if (!online) {
      stopBackgroundLocation()
      return
    }
    let cancelled = false
    let arming = false
    const arm = async () => {
      // serialize: arm() runs on mount and on every AppState→active, so overlapping
      // runs would race startBackgroundLocation's stop/start and churn the
      // foreground-service notification. Drop any call while one is in flight.
      if (arming) return
      arming = true
      try {
        // Opportunistic immediate fix so the map updates without waiting a whole
        // interval — fire-and-forget. It must NEVER gate the heartbeat start below:
        // getCurrentPositionAsync has no timeout and can hang indefinitely on a
        // cold/indoor GPS, and a wedged fix would mean the task never starts, no
        // heartbeats are sent, and the server drops the officer past the online TTL
        // while the UI still shows them online. The task emits its own first fix.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then((pos) => pushLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
          .catch(() => {}) // skip; the background task catches up on its first tick

        let minutes = DEFAULT_POLL_MIN
        try {
          // bounded: axios has no default timeout, so a stalled request would also
          // wedge the start — fall back to the default cadence instead
          const res = await api.get<{ minutes: number }>('/officers/location-poll-interval', {
            timeout: 8000,
          })
          if (res.data?.minutes > 0) minutes = res.data.minutes
        } catch {
          // fall back to the default cadence
        }
        if (cancelled) return
        // Android forbids starting a foreground-service task from the background. The
        // await above leaves a window where the app can be backgrounded, so re-check
        // here and bail if so — the AppState 'active' listener below re-arms when the
        // officer returns to the app.
        if (AppState.currentState !== 'active') return
        try {
          await startBackgroundLocation(Math.max(minutes, MIN_POLL_MIN) * 60 * 1000)
        } catch {
          // OS refused the start (e.g. raced into the background); next resume re-arms
        }
      } finally {
        arming = false
      }
    }
    arm()
    // Android can kill the foreground-service location task during screen-off Doze
    // (or OEM battery optimization). The effect won't re-run on resume, so without
    // this the officer silently stops reporting until they re-toggle online.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') arm()
    })
    return () => {
      cancelled = true
      sub.remove()
      // runs on online→false AND on unmount (logout); without this the
      // foreground-service GPS loop keeps running after logout
      stopBackgroundLocation()
    }
  }, [online, pushLocation])

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }
  if (!user) return <Redirect href="/Login" />
  if (!user.is_verified) return <Redirect href="/Pending" />

  // hidden detail screens (reached from Setting) get a header + back button; the
  // tab bar is suppressed so they read as pushed pages, not tabs.
  const detailOptions = (title: string) => ({
    href: null as null,
    headerShown: true,
    title,
    tabBarStyle: { display: 'none' as const },
    headerLeft: () => (
      <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 16 }}>
        <Ionicons name="chevron-back" size={24} color={colors.accent} />
      </Pressable>
    ),
    headerTitleStyle: { fontFamily: fonts.semibold, color: colors.accent },
    headerStyle: { backgroundColor: colors.foreground },
    headerShadowVisible: false,
  })

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray400,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.foreground, borderTopColor: colors.border, height: 80 },
        tabBarItemStyle: { paddingBottom: 8 },
      }}
    >
      <Tabs.Screen
        name="MapView"
        options={{
          title: 'แผนที่',
          tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Firespot"
        options={{
          title: 'ไฟของคุณ',
          tabBarIcon: ({ color, size }) => <Ionicons name="flame-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Setting"
        options={{
          title: 'การตั้งค่า',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="Account" options={detailOptions('บัญชีของฉัน')} />
      <Tabs.Screen name="RegionChange" options={detailOptions('ย้ายพื้นที่รับผิดชอบ')} />
      <Tabs.Screen name="History" options={detailOptions('ประวัติการดับไฟ')} />
    </Tabs>
  )
}