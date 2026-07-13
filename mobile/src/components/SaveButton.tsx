import { ActivityIndicator, Pressable, Text } from 'react-native'

/**
 * Primary submit button that swaps its label for a spinner while a request is pending.
 *
 * @param label - button text shown when not loading
 * @param onPress - press handler; not invoked while `loading` is true (button is disabled)
 * @param loading - true while the associated action is in flight
 */
export default function SaveButton({
  label,
  onPress,
  loading,
}: {
  label: string
  onPress: () => void
  loading: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className={`items-center rounded-2xl py-4 ${loading ? 'bg-gray-400' : 'bg-primary'}`}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-base font-sans-semibold text-white">{label}</Text>}
    </Pressable>
  )
}
