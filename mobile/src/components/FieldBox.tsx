import { Text, View } from 'react-native'

/**
 * Layout shell for a labeled form field: a rounded, tinted card with a small
 * caption label above arbitrary content (typically an input).
 *
 * @param label - caption text rendered above `children`
 * @param className - overrides the default padding (`px-4 py-3`); the base rounded/background classes always apply
 * @param children - field content, e.g. a `TextInput`
 */
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
