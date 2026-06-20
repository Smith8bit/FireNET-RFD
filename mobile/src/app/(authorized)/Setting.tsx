import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthSession } from '@/providers/AuthProvider'

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }

const ROWS: Row[] = [
  { icon: 'person-circle-outline', label: 'บัญชีของฉัน', route: '/(authorized)/Account' },
  { icon: 'time-outline', label: 'ประวัติการดับไฟ', route: '/(authorized)/History' },
  { icon: 'trophy-outline', label: 'อันดับประจำเดือน', route: '/(authorized)/Leaderboard' },
]

export default function Setting() {
  const { user, signOut } = useAuthSession()
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Ionicons name="person-circle" size={48} color="#10b981" />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.name}>{user?.name ?? 'เจ้าหน้าที่ภาคสนาม'}</Text>
            <Text style={styles.email}>{user?.username}</Text>
            {user?.division ? <Text style={styles.email}>{user.division}</Text> : null}
          </View>
        </View>

        <View style={styles.card}>
          {ROWS.map((r, i) => (
            <Pressable
              key={r.route}
              onPress={() => router.push(r.route as never)}
              style={[styles.row, i > 0 && styles.rowBorder]}
            >
              <Ionicons name={r.icon} size={22} color="#6b7280" />
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#d1d5db" style={{ marginLeft: 'auto' }} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={signOut} style={styles.logout}>
          <Ionicons name="log-out-outline" size={20} color="#b91c1c" />
          <Text style={styles.logoutText}>ออกจากระบบ</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  name: { fontSize: 18, fontWeight: '700' },
  email: { fontSize: 13, color: '#6b7280' },
  card: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb' },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: '#fecaca' },
  logoutText: { color: '#b91c1c', fontSize: 16, fontWeight: '600' },
})
