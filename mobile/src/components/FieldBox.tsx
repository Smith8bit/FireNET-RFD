import { Text, View } from 'react-native'

// Filled, rounded field with a small label pinned to its top-left corner.
// `className` overrides only the padding (defaults to the common px-4 py-3).
export default function FieldBox({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <View className={`rounded-2xl bg-background/40 ${className ?? 'px-4 py-3'}`}>
      <Text className="text-sm font-head text-muted-foreground">{label}</Text>
      {children}
    </View>
  )
}
