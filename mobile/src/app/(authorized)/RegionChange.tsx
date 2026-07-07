import PROVINCES from '@/data/provinces.json'
import { api } from '@/lib/api'
import { apiErrorMessage } from '@/lib/apiError'
import { shadows } from '@/lib/theme'
import { toast } from '@/lib/toastStore'
import FieldBox from '@/components/FieldBox'
import SaveButton from '@/components/SaveButton'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native'
import { Dropdown } from 'react-native-element-dropdown'
import { SafeAreaView } from 'react-native-safe-area-context'

const dropdownStyle = { borderWidth: 0, backgroundColor: 'transparent', paddingVertical: 2 } as const

const PROVINCE_ITEM_HEIGHT = 48

export default function RegionChange() {
  const [province, setProvince] = useState<string | null>(null)
  const [pending, setPending] = useState<{ status: string; province: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadPending = useCallback(
    () =>
      api.get('/officers/me/region-change').then((r) => {
        setPending(r.data?.status === 'pending' ? r.data : null)
      }).catch(() => {}),
    [],
  )

  useFocusEffect(useCallback(() => { loadPending() }, [loadPending]))

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    loadPending().finally(() => setRefreshing(false))
  }, [loadPending])

  const submitRegion = async () => {
    if (!province) {
      toast.error('กรุณาเลือกจังหวัด')
      return
    }
    setBusy(true)
    try {
      const r = await api.post('/officers/me/region-change', { province_code: province })
      setPending({ status: 'pending', province: r.data.province })
      toast.success('ส่งคำขอแล้ว คำขอย้ายพื้นที่จะถูกส่งให้ผู้ดูแลอนุมัติ')
    } catch (e) {
      toast.error(apiErrorMessage(e, 'ไม่สามารถส่งคำขอได้'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-foreground" edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {pending ? (
          <Text className="rounded-2xl bg-[#fffbeb] p-4 text-sm font-head text-[#b45309]">
            รออนุมัติย้ายไป: {pending.province}
          </Text>
        ) : (
          <>
            <FieldBox label="จังหวัดปลายทาง">
              <Dropdown
                data={PROVINCES}
                labelField="name_th"
                valueField="code"
                placeholder="เลือกจังหวัด..."
                search
                searchPlaceholder="ค้นหาจังหวัด..."
                value={province}
                onChange={(item: any) => setProvince(item.code)}
                style={dropdownStyle}
                selectedTextStyle={{ fontSize: 18, color: '#1A1A1A' }}
                placeholderStyle={{ fontSize: 18, color: '#9ca3af' }}
                inputSearchStyle={{ fontSize: 18, borderRadius: 6 }}
                autoScroll
                maxHeight={320}
                activeColor="#ffebe5"
                itemContainerStyle={{ height: PROVINCE_ITEM_HEIGHT, justifyContent: 'center' }}
                renderItem={(item: any) => (
                  <Text style={{ paddingHorizontal: 16, fontSize: 18, color: '#1A1A1A' }}>{item.name_th}</Text>
                )}
                flatListProps={{
                  getItemLayout: (_, index) => ({
                    length: PROVINCE_ITEM_HEIGHT,
                    offset: PROVINCE_ITEM_HEIGHT * index,
                    index,
                  }),
                }}
              />
            </FieldBox>
            <Text className="text-sm font-head text-muted-foreground">คำขอจะถูกส่งให้ผู้ดูแลพื้นที่ปลายทางอนุมัติ</Text>
            <SaveButton label="ส่งคำขอย้ายพื้นที่" onPress={submitRegion} loading={busy} />
          </>
        )}
      </ScrollView>

      <Pressable
        className="absolute bottom-12 right-4 h-16 w-16 items-center justify-center rounded-full bg-secondary"
        style={shadows.float}
        onPress={onRefresh}
        disabled={refreshing}
        hitSlop={8}
      >
        {refreshing ? <ActivityIndicator color={'#FFFFFF'} /> : <Ionicons name="refresh" size={26} color={'#FFFFFF'} />}
      </Pressable>
    </SafeAreaView>
  )
}
