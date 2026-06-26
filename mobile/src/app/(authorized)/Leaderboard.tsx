import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '@/lib/api'

type Row = { rank: number; name: string; count: number; is_me: boolean }

const MEDAL = ['🥇', '🥈', '🥉']

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const rowShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

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
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.rank)}
        contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
        ListHeaderComponent={
          <Text className="mb-2 text-[13px] font-head text-gray-500">จำนวนไฟที่ดับได้เดือนนี้ (ไม่รวมการแจ้งผิดพลาด)</Text>
        }
        ListEmptyComponent={
          loaded ? (
            <Text className="mt-12 text-center font-head text-gray-400">ยังไม่มีข้อมูลเดือนนี้</Text>
          ) : (
            <ActivityIndicator style={{ marginTop: 48 }} />
          )
        }
        renderItem={({ item }) => (
          <View
            className={`flex-row items-center gap-3 rounded-2xl bg-foreground px-4 py-3.5 ${
              item.is_me ? 'border-[1.5px] border-primary bg-flame-light' : ''
            }`}
            style={rowShadow}
          >
            <Text className="w-8 text-center text-base font-sans-bold text-accent">{MEDAL[item.rank - 1] ?? item.rank}</Text>
            <Text
              className={`flex-1 shrink text-[15px] ${item.is_me ? 'font-sans-bold text-primary' : 'font-sans text-card-foreground'}`}
              numberOfLines={1}
            >
              {item.name}{item.is_me ? ' (คุณ)' : ''}
            </Text>
            <Text className="text-base font-sans-bold text-accent">{item.count}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  )
}
