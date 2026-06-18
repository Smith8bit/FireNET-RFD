import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '@/lib/api'

type Row = { rank: number; name: string; count: number; is_me: boolean }

const MEDAL = ['🥇', '🥈', '🥉']

export default function Leaderboard() {
  const [items, setItems] = useState<Row[]>([])
  const [month, setMonth] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api.get<{ month: string; items: Row[] }>('/officers/me/leaderboard')
      .then((r) => { setItems(r.data.items); setMonth(r.data.month) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.rank)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <Text style={styles.subtitle}>จำนวนไฟที่ดับได้เดือนนี้ (ไม่รวมการแจ้งผิดพลาด)</Text>
        }
        ListEmptyComponent={
          loaded ? <Text style={styles.empty}>ยังไม่มีข้อมูลเดือนนี้</Text> : <ActivityIndicator style={{ marginTop: 48 }} />
        }
        renderItem={({ item }) => (
          <View style={[styles.row, item.is_me && styles.rowMe]}>
            <Text style={styles.rank}>{MEDAL[item.rank - 1] ?? item.rank}</Text>
            <Text style={[styles.name, item.is_me && styles.nameMe]} numberOfLines={1}>
              {item.name}{item.is_me ? ' (คุณ)' : ''}
            </Text>
            <Text style={styles.count}>{item.count}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, gap: 8, flexGrow: 1 },
  subtitle: { fontSize: 13, color: '#6b7280', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16 },
  rowMe: { borderWidth: 1.5, borderColor: '#10b981' },
  rank: { fontSize: 16, fontWeight: '700', width: 32, textAlign: 'center' },
  name: { fontSize: 15, flexShrink: 1, flex: 1 },
  nameMe: { fontWeight: '700', color: '#047857' },
  count: { fontSize: 16, fontWeight: '700', color: '#374151' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 48 },
})
