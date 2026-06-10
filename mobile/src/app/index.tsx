import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAuthSession } from '@/providers/AuthProvider'

export default function Index() {
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
  return <Redirect href="/(authorized)/MapView" />
}
