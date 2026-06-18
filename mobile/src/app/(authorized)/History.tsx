import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '@/lib/api'
import { formatDetectedAt } from '@/utils/format'

type Item = {
  fire_id: string
  name: string
  tumboon: string | null
  aumper: string | null
  province: string | null
  resolved_at: string
  note: string | null
  false_alarm: boolean
}

const PAGE = 20

export default function History() {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (offset: number) => {
    if (loading) return
    setLoading(true)
    try {
      const r = await api.get<{ total: number; items: Item[] }>('/officers/me/resolutions', {
        params: { limit: PAGE, offset },
      })
      setItems((prev) => (offset === 0 ? r.data.items : [...prev, ...r.data.items]))
      setTotal(r.data.total)
    } catch {
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [loading])

  useEffect(() => { load(0) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.fire_id}
        contentContainerStyle={styles.content}
        onEndReached={() => { if (loaded && items.length < total) load(items.length) }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loaded && !loading ? <Text style={styles.empty}>ยังไม่มีประวัติการดับไฟ</Text> : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{item.name}</Text>
              <View style={[styles.badge, item.false_alarm ? styles.badgeFalse : styles.badgeOk]}>
                <Text style={styles.badgeText}>{item.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {[item.tumboon, item.aumper, item.province].filter(Boolean).join(' · ') || '-'}
            </Text>
            <Text style={styles.meta}>{formatDetectedAt(item.resolved_at)}</Text>
            {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, gap: 12, flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  meta: { fontSize: 13, color: '#6b7280' },
  note: { fontSize: 13, color: '#374151', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  badgeOk: { backgroundColor: '#10b981' },
  badgeFalse: { backgroundColor: '#6b7280' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 48 },
})
