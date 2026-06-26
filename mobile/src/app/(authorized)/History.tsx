import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Text, View } from 'react-native'
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

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

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
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.fire_id}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        onEndReached={() => { if (loaded && items.length < total) load(items.length) }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loaded && !loading ? (
            <Text className="mt-12 text-center font-head text-gray-400">ยังไม่มีประวัติการดับไฟ</Text>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
        renderItem={({ item }) => (
          <View className="gap-1 rounded-2xl bg-foreground p-3.5" style={cardShadow}>
            <View className="flex-row items-center justify-between">
              <Text className="shrink text-[15px] font-sans-bold text-card-foreground">{item.name}</Text>
              <View className={`ml-2 rounded-full px-2 py-0.5 ${item.false_alarm ? 'bg-gray-500' : 'bg-success'}`}>
                <Text className="text-[11px] font-sans-semibold text-white">{item.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}</Text>
              </View>
            </View>
            <Text className="text-[13px] font-head text-gray-500">
              {[item.tumboon, item.aumper, item.province].filter(Boolean).join(' · ') || '-'}
            </Text>
            <Text className="text-[13px] font-head text-gray-500">{formatDetectedAt(item.resolved_at)}</Text>
            {item.note ? <Text className="mt-0.5 text-[13px] font-head text-muted-foreground">{item.note}</Text> : null}
          </View>
        )}
      />
    </SafeAreaView>
  )
}
