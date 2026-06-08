import { Redirect, Tabs } from 'expo-router'
// import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, View } from 'react-native'
import { useAuthSession } from '@/providers/AuthProvider'

export default function AuthorizedLayout() {
  const { user, isLoading } = useAuthSession()

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
      <Tabs.Screen name="MapView" options={{ title: 'แผนที่' }} />
      <Tabs.Screen 
        name="index"
        options={{ title: 'หน้าหลัก' }}
      />
    </Tabs>
  )
}