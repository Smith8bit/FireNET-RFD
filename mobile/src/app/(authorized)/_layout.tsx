import { useEffect } from 'react'
import { Redirect, Tabs, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, View } from 'react-native'
import * as Location from 'expo-location'
import { useAuthSession } from '@/providers/AuthProvider'
import { useFireStore } from '@/stores/fireStore'
import { setupNotificationHandlers } from '@/lib/push'

const LOCATION_POLL_MS = 5 * 60 * 1000

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
    const unsubscribe = setupNotificationHandlers(() => {
      loadReservedFire()
      loadFires()
      router.navigate('/(authorized)/Firespot')
    })
    return unsubscribe
  }, [loadReservedFire, loadFires])

  // While online, push the officer's position immediately and then every 5 minutes.
  // Coords-only (no `active`): going offline is owned solely by the toggle.
  useEffect(() => {
    if (!online) return
    const push = async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        await pushLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
      } catch {
        // skip this tick; next poll retries
      }
    }
    push()
    const id = setInterval(push, LOCATION_POLL_MS)
    return () => clearInterval(id)
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

  return (
    <Tabs screenOptions={{ headerShown: false }}>
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
    </Tabs>
  )
}