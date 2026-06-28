import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Dropdown } from 'react-native-element-dropdown'
import { api } from '@/lib/api'
import PROVINCES from '@/data/provinces.json'

function errMsg(e: any, fallback: string) {
  const d = e?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}

// Plain style objects for the Dropdown (it doesn't accept className). It sits
// inside a FieldBox that supplies the filled background, so it stays transparent.
const dropdownStyle = { borderWidth: 0, backgroundColor: 'transparent', paddingVertical: 2 } as const

// Fixed row height so the dropdown's auto-scroll-to-selected (scrollToIndex) is
// reliable for provinces far down the list — it needs a matching getItemLayout.
const PROVINCE_ITEM_HEIGHT = 48

export default function RegionChange() {
  const [province, setProvince] = useState<string | null>(null)
  const [pending, setPending] = useState<{ status: string; province: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // refresh on every focus so the screen resets to the default dropdown once a
  // request is decided (approved/rejected) — a still-pending one keeps disabling resubmit
  useFocusEffect(
    useCallback(() => {
      api.get('/officers/me/region-change').then((r) => {
        setPending(r.data?.status === 'pending' ? r.data : null)
      }).catch(() => {})
    }, []),
  )

  const submitRegion = async () => {
    if (!province) return Alert.alert('กรุณาเลือกจังหวัด')
    setBusy(true)
    try {
      const r = await api.post('/officers/me/region-change', { province_code: province })
      setPending({ status: 'pending', province: r.data.province })
      Alert.alert('ส่งคำขอแล้ว', 'คำขอย้ายพื้นที่จะถูกส่งให้ผู้ควบคุมอนุมัติ')
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', errMsg(e, 'ไม่สามารถส่งคำขอได้'))
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
            <Text className="text-sm font-head text-muted-foreground">คำขอจะถูกส่งให้ผู้ควบคุมพื้นที่ปลายทางอนุมัติ</Text>
            <SaveButton label="ส่งคำขอย้ายพื้นที่" onPress={submitRegion} loading={busy} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// Filled, rounded field with a small label pinned to its top-left corner.
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl bg-background/40 px-4 py-3">
      <Text className="text-sm font-head text-muted-foreground">{label}</Text>
      {children}
    </View>
  )
}

function SaveButton({ label, onPress, loading }: { label: string; onPress: () => void; loading: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className={`items-center rounded-2xl py-4 ${loading ? 'bg-gray-400' : 'bg-primary'}`}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-base font-sans-semibold text-white">{label}</Text>}
    </Pressable>
  )
}
