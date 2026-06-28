import { api, getToken } from '@/lib/api'
import { formatDetectedAt } from '@/utils/format'
import { Ionicons } from '@expo/vector-icons'
import { File, Paths } from 'expo-file-system'
import { Image } from 'expo-image'
import * as MediaLibrary from 'expo-media-library'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Item = {
  fire_id: string
  name: string
  tumboon: string | null
  aumper: string | null
  province: string | null
  resolved_at: string
  note: string | null
  false_alarm: boolean
  image_ids: string[]
}

const PAGE = 20

// evidence images are served by the API (region-scoped), so the request needs the bearer token
const imageSource = (fireId: string, imageId: string) => ({
  uri: `${api.defaults.baseURL}/fires/${fireId}/images/${imageId}`,
  headers: { Authorization: `Bearer ${getToken() ?? ''}` },
})

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

// floating refresh button's shadow — kept inline since it has no faithful className
const floatShadow = {
  elevation: 4,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

export default function History() {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // the evidence image shown full-screen, or null when the viewer is closed
  const [viewer, setViewer] = useState<{ fireId: string; imageId: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [perm, requestPerm] = MediaLibrary.usePermissions()

  // download the (auth-gated) evidence image to a temp file, then add it to the gallery
  const saveImage = useCallback(async (fireId: string, imageId: string) => {
    if (saving) return
    setSaving(true)
    let file: File | null = null
    try {
      const granted = perm?.granted ? perm : await requestPerm()
      if (!granted.granted) {
        Alert.alert('ไม่ได้รับอนุญาต', 'กรุณาอนุญาตให้แอปบันทึกรูปภาพลงในคลังภาพ')
        return
      }
      const dest = new File(Paths.cache, `fire-${imageId}.jpg`)
      if (dest.exists) dest.delete() // a stale temp from a crashed prior attempt would block the download
      file = await File.downloadFileAsync(
        `${api.defaults.baseURL}/fires/${fireId}/images/${imageId}`,
        dest,
        { headers: { Authorization: `Bearer ${getToken() ?? ''}` } },
      )
      await MediaLibrary.Asset.create(file.uri)
      Alert.alert('บันทึกแล้ว', 'บันทึกรูปภาพลงในคลังภาพเรียบร้อยแล้ว')
    } catch {
      Alert.alert('บันทึกไม่สำเร็จ', 'ไม่สามารถบันทึกรูปภาพได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      try { file?.delete() } catch {} // best-effort cleanup of the temp copy
      setSaving(false)
    }
  }, [saving, perm, requestPerm])

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
    <SafeAreaView className="flex-1 bg-foreground" edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.fire_id}
        contentContainerStyle={{ padding: 12 , gap: 3, flexGrow: 1 }}
        onEndReached={() => { if (loaded && items.length < total) load(items.length) }}
        onEndReachedThreshold={0.4}
        // lazy-load evidence images: keep fewer off-screen rows mounted so their
        // thumbnails only fetch as they near the viewport. (No removeClippedSubviews —
        // on Android it mis-measures rows mounted after scroll, squishing the badge.)
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        ListEmptyComponent={
          loaded && !loading ? (
            <Text className="mt-12 text-center font-head text-gray-400">ยังไม่มีประวัติการดับไฟ</Text>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
        renderItem={({ item }) => (
          <View className="gap-1 rounded-2xl bg-foreground p-3.5 border-border border-b">
            <View className="flex-row items-center justify-between">
              <Text className="shrink text-md font-sans-semibold text-card-foreground" numberOfLines={1}>{item.name}</Text>
              <View className={`ml-2 shrink-0 rounded-full px-2 py-0.5 ${item.false_alarm ? 'bg-gray-500' : 'bg-success'}`}>
                <Text className="text-sm font-sans-medium text-white" numberOfLines={1}>{item.false_alarm ? 'ไม่ใช่ไฟ' : 'ดับแล้ว'}</Text>
              </View>
            </View>
            <Text className="text-sm font-head text-gray-500">
              {[item.tumboon, item.aumper, item.province].filter(Boolean).join(' · ') || '-'}
            </Text>
            <Text className="text-sm font-head text-gray-500">{formatDetectedAt(item.resolved_at)}</Text>
            {item.note ? <Text className="mt-0.5 text-sm font-head text-muted-foreground">หมายเหตุ: {item.note}</Text> : null}
            {item.image_ids.length > 0 && (
              <View className="mt-1 flex-row gap-2">
                {item.image_ids.map((id) => (
                  <Pressable key={id} onPress={() => setViewer({ fireId: item.fire_id, imageId: id })}>
                    <Image
                      source={imageSource(item.fire_id, id)}
                      style={{ width: 80, height: 80, borderRadius: 8 }}
                      contentFit="cover"
                      transition={150}
                      recyclingKey={id}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      />

      <Pressable
        className="absolute bottom-12 right-4 h-16 w-16 items-center justify-center rounded-full bg-secondary"
        style={floatShadow}
        onPress={() => load(0)}
        disabled={loading}
        hitSlop={8}
      >
        {loading ? <ActivityIndicator color={'#FFFFFF'} /> : <Ionicons name="refresh" size={26} color={'#FFFFFF'} />}
      </Pressable>

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable className="flex-1 items-center justify-center bg-black/90" onPress={() => setViewer(null)}>
          {viewer && (
            <Image
              source={imageSource(viewer.fireId, viewer.imageId)}
              style={{ width: '100%', height: '80%' }}
              contentFit="contain"
              transition={150}
            />
          )}
          <Pressable
            className="absolute right-5 top-14 h-10 w-10 items-center justify-center rounded-full bg-black/50"
            onPress={() => setViewer(null)}
            hitSlop={8}
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {viewer && (
            <Pressable
              className="absolute bottom-12 flex-row items-center gap-2 rounded-full bg-black/50 px-5 py-3"
              onPress={() => saveImage(viewer.fireId, viewer.imageId)}
              disabled={saving}
              hitSlop={8}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Ionicons name="download-outline" size={20} color="#fff" />}
              <Text className="font-sans-medium text-white">{saving ? 'กำลังบันทึก...' : 'บันทึกรูปภาพ'}</Text>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}
