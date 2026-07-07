import { ActivityIndicator, Pressable, Text } from 'react-native'

// Full-width primary action button that swaps its label for a spinner while busy.
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
