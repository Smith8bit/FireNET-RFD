import { colors } from '@/lib/theme'
import { useAuthSession } from '@/providers/AuthProvider'
import { Ionicons } from '@expo/vector-icons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }

const ROWS: Row[] = [
  { icon: 'person-circle-outline', label: 'บัญชีของฉัน', route: '/(authorized)/Account' },
  { icon: 'swap-horizontal-outline', label: 'ย้ายพื้นที่รับผิดชอบ', route: '/(authorized)/RegionChange' },
  { icon: 'time-outline', label: 'ประวัติการดับไฟ', route: '/(authorized)/History' },
]

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

function LogoutButton({ onConfirm }: { onConfirm: () => void }) {
  const [expanded, setExpanded] = useState(false)
  useFocusEffect(useCallback(() => () => setExpanded(false), []))
  return (
    <View className="mt-1 items-end">
      {expanded ? (
        <Pressable
          onPress={onConfirm}
          className="flex-row items-center justify-center gap-2 w-full rounded-full bg-destructive py-3.5"
        >
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text className="text-base font-sans-semibold text-white">ออกจากระบบ</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setExpanded(true)}
          className="items-center justify-center rounded-full bg-destructive"
          style={{ width: 52, height: 52 }}
        >
          <Ionicons name="log-out-outline" size={22} color="#fff" />
        </Pressable>
      )}
    </View>
  )
}

export default function Setting() {
  const { user, signOut } = useAuthSession()
  return (
    <SafeAreaView className="flex-1 bg-foreground">
      <View style={{ flex: 1, padding: 12, gap: 12 }}>
        <View className="flex-row items-center p-3 gap-3 rounded-2xl bg-foreground border-border" style={cardShadow}>
          <Ionicons name="person-circle" size={64} color={colors.primary} />
          <View className="shrink">
            <Text className="text-xl font-sans-bold text-accent">{user?.name ?? 'เจ้าหน้าที่ภาคสนาม'}</Text>
            {user?.division ? <Text className="text-md font-head-medium text-gray-500">สังกัด: {user.division}</Text> : null}
          </View>
        </View>

        <View className="rounded-2xl bg-foreground px-4 flex-1">
          {ROWS.map((r, i) => (
            <Pressable
              key={r.route}
              onPress={() => router.push(r.route as never)}
              className={`flex-row items-center gap-3 py-5 ${i < ROWS.length - 1 ? 'border-b border-border' : ''}`}
            >
              <Ionicons name={r.icon} size={24} color={colors.gray500} />
              <Text className="text-md font-sans-medium text-card-foreground">{r.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.gray400} style={{ marginLeft: 'auto' }} />
            </Pressable>
          ))}
          <LogoutButton onConfirm={signOut} />
        </View>


      </View>
    </SafeAreaView>
  )
}
