import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAuthSession } from '@/providers/AuthProvider'

/**
 * App entry route: resolves the auth session and redirects to the correct
 * screen. Renders no UI of its own — it's a routing gate, not a page.
 *
 * Depends on `useAuthSession` having already restored/validated any persisted
 * session before `isLoading` flips to false.
 *
 * @returns a spinner while the session is loading, otherwise a `Redirect` to
 * Login (no session), Pending (unverified account), or MapView (authorized)
 */
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
  return <Redirect href="/MapView" />
}
