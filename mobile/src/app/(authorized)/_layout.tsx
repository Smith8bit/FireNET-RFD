import { api } from '@/lib/api'
import { startBackgroundLocation, stopBackgroundLocation } from '@/lib/locationTask'
import { setupNotificationHandlers } from '@/lib/push'
import { colors, fonts } from '@/lib/theme'
import { useAuthSession } from '@/providers/AuthProvider'
import { useFireStore } from '@/stores/fireStore'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { Redirect, Stack, router } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, AppState, Pressable, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

const DEFAULT_POLL_MIN = 5
const MIN_POLL_MIN = 1

export default function AuthorizedLayout() {
  const { user, isLoading } = useAuthSession()
  const reducedMotion = useReducedMotion()
  const online = useFireStore((s) => s.online)
  const pushLocation = useFireStore((s) => s.pushLocation)
  const loadStatus = useFireStore((s) => s.loadStatus)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const loadFires = useFireStore((s) => s.loadFires)

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const unsubscribe = setupNotificationHandlers(
      () => {
        loadReservedFire()
        loadFires()
        router.navigate('/Firespot')
      },
      () => {
        loadReservedFire()
        loadFires()
      },
    )
    return unsubscribe
  }, [loadReservedFire, loadFires])

  useEffect(() => {
    if (!online) {
      stopBackgroundLocation()
      return
    }
    let cancelled = false
    let arming = false
    const arm = async () => {
      if (arming) return
      arming = true
      try {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then((pos) => pushLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }))
          .catch(() => {})

        let minutes = DEFAULT_POLL_MIN
        try {
          const res = await api.get<{ minutes: number }>('/officers/location-poll-interval', {
            timeout: 8000,
          })
          if (res.data?.minutes > 0) minutes = res.data.minutes
        } catch {
        }
        if (cancelled) return
        if (AppState.currentState !== 'active') return
        try {
          await startBackgroundLocation(Math.max(minutes, MIN_POLL_MIN) * 60 * 1000)
        } catch {
        }
      } finally {
        arming = false
      }
    }
    arm()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') arm()
    })
    return () => {
      cancelled = true
      sub.remove()
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

  const detailAnimation: 'none' | 'ios_from_right' = reducedMotion ? 'none' : 'ios_from_right'
  const detailOptions = (title: string) => ({
    title,
    headerShown: true,
    animation: detailAnimation,
    fullScreenGestureEnabled: true,
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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="Account" options={detailOptions('บัญชีของฉัน')} />
      <Stack.Screen name="RegionChange" options={detailOptions('ย้ายพื้นที่รับผิดชอบ')} />
      <Stack.Screen name="History" options={detailOptions('ประวัติการดับไฟ')} />
    </Stack>
  )
}
