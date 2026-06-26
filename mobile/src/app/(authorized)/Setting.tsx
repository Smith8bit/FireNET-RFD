import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthSession } from '@/providers/AuthProvider'
import { colors } from '@/lib/theme'

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }

const ROWS: Row[] = [
  { icon: 'person-circle-outline', label: 'บัญชีของฉัน', route: '/(authorized)/Account' },
  { icon: 'time-outline', label: 'ประวัติการดับไฟ', route: '/(authorized)/History' },
  { icon: 'trophy-outline', label: 'อันดับประจำเดือน', route: '/(authorized)/Leaderboard' },
]

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

export default function Setting() {
  const { user, signOut } = useAuthSession()
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="flex-row items-center gap-3 pt-2">
          <Ionicons name="person-circle" size={48} color={colors.primary} />
          <View className="shrink">
            <Text className="text-lg font-sans-bold text-accent">{user?.name ?? 'เจ้าหน้าที่ภาคสนาม'}</Text>
            <Text className="text-[13px] font-head text-gray-500">{user?.username}</Text>
            {user?.division ? <Text className="text-[13px] font-head text-gray-500">{user.division}</Text> : null}
          </View>
        </View>

        <View className="rounded-2xl bg-foreground px-4" style={cardShadow}>
          {ROWS.map((r, i) => (
            <Pressable
              key={r.route}
              onPress={() => router.push(r.route as never)}
              className={`flex-row items-center gap-3 py-4 ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <Ionicons name={r.icon} size={22} color={colors.gray500} />
              <Text className="text-[15px] font-sans-medium text-card-foreground">{r.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.gray300} style={{ marginLeft: 'auto' }} />
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={signOut}
          className="flex-row items-center justify-center gap-2 rounded-xl border border-[#FECACA] bg-foreground py-3.5"
        >
          <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
          <Text className="text-base font-sans-semibold text-destructive">ออกจากระบบ</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}
