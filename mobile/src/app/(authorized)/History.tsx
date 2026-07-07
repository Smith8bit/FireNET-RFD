import { api, getToken } from '@/lib/api'
import { shadows } from '@/lib/theme'
import { toast } from '@/lib/toastStore'
import { formatDetectedAt } from '@/utils/format'
import { Ionicons } from '@expo/vector-icons'
import { File, Paths } from 'expo-file-system'
import { Image } from 'expo-image'
import * as MediaLibrary from 'expo-media-library'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native'
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
  images: { id: string; content_type: string }[]
}

const PAGE = 20

// Fallback extension used when a content-type isn't one of the known evidence formats (should not normally occur).
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
}

// Evidence files are served behind auth, so every request (thumbnail, full view, or download) needs the bearer token attached.
const evidenceSource = (fireId: string, imageId: string) => ({
  uri: `${api.defaults.baseURL}/fires/${fireId}/images/${imageId}`,
  headers: { Authorization: `Bearer ${getToken() ?? ''}` },
})

/**
 * Autoplaying inline video player for a single evidence video, used inside the fullscreen viewer modal.
 *
 * @param fireId - fire the evidence belongs to
 * @param imageId - id of the specific evidence item (despite the name, may be a video)
 */
function EvidenceVideo({ fireId, imageId }: { fireId: string; imageId: string }) {
  const player = useVideoPlayer(evidenceSource(fireId, imageId), (p) => { p.play() })
  return <VideoView player={player} style={{ width: '100%', height: '80%' }} contentFit="contain" />
}

/**
 * Paginated list of the officer's own resolved fire reports, each with any
 * attached photo/video evidence viewable fullscreen and savable to the
 * device's media library.
 *
 * @returns an infinite-scrolling list with a pull-to-reload button and an evidence viewer modal
 */
export default function History() {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [viewer, setViewer] = useState<{ fireId: string; imageId: string; contentType: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [perm, requestPerm] = MediaLibrary.usePermissions()

  // MediaLibrary has no "save from URL" API, so the evidence file is downloaded to a scratch
  // location in cache first, imported into the gallery, then the scratch copy is always cleaned up.
  const saveEvidence = useCallback(async (fireId: string, imageId: string, contentType: string) => {
    if (saving) return
    setSaving(true)
    let file: File | null = null
    try {
      const granted = perm?.granted ? perm : await requestPerm()
      if (!granted.granted) {
        toast.error('กรุณาอนุญาตให้แอปบันทึกไฟล์ลงในคลังภาพ')
        return
      }
      const dest = new File(Paths.cache, `fire-${imageId}.${EXT[contentType] ?? 'bin'}`)
      if (dest.exists) dest.delete()
      file = await File.downloadFileAsync(
        `${api.defaults.baseURL}/fires/${fireId}/images/${imageId}`,
        dest,
        { headers: { Authorization: `Bearer ${getToken() ?? ''}` } },
      )
      await MediaLibrary.Asset.create(file.uri)
      toast.success('บันทึกไฟล์ลงในคลังภาพเรียบร้อยแล้ว')
    } catch {
      toast.error('ไม่สามารถบันทึกไฟล์ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      // Best-effort cleanup: if the download itself failed, `file` is still null and there's nothing to delete.
      try { file?.delete() } catch {}
      setSaving(false)
    }
  }, [saving, perm, requestPerm])

  // offset === 0 means "reload from scratch" (replace the list); any other offset means "load more" (append).
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

  useEffect(() => { load(0) }, [])

  return (
    <SafeAreaView className="flex-1 bg-foreground" edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.fire_id}
        contentContainerStyle={{ padding: 12 , gap: 3, flexGrow: 1 }}
        // Guards against firing before the first page has loaded, and stops once every item has been fetched.
        onEndReached={() => { if (loaded && items.length < total) load(items.length) }}
        onEndReachedThreshold={0.4}
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
            {item.images.length > 0 && (
              <View className="mt-1 flex-row gap-2">
                {item.images.map(({ id, content_type }) =>
                  content_type.startsWith('video/') ? (
                    <Pressable
                      key={id}
                      onPress={() => setViewer({ fireId: item.fire_id, imageId: id, contentType: content_type })}
                      className="h-20 w-20 items-center justify-center rounded-lg bg-secondary"
                    >
                      <Ionicons name="play-circle" size={30} color="#ffffff" />
                      <Text className="mt-0.5 text-xs font-head text-white">วิดีโอ</Text>
                    </Pressable>
                  ) : (
                    <Pressable key={id} onPress={() => setViewer({ fireId: item.fire_id, imageId: id, contentType: content_type })}>
                      <Image
                        source={evidenceSource(item.fire_id, id)}
                        style={{ width: 80, height: 80, borderRadius: 8 }}
                        contentFit="cover"
                        transition={150}
                        recyclingKey={id}
                      />
                    </Pressable>
                  ),
                )}
              </View>
            )}
          </View>
        )}
      />

      <Pressable
        className="absolute bottom-12 right-4 h-16 w-16 items-center justify-center rounded-full bg-secondary"
        style={shadows.float}
        onPress={() => load(0)}
        disabled={loading}
        hitSlop={8}
      >
        {loading ? <ActivityIndicator color={'#FFFFFF'} /> : <Ionicons name="refresh" size={26} color={'#FFFFFF'} />}
      </Pressable>

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View className="flex-1 items-center justify-center bg-black/90">
          <Pressable className="absolute inset-0" onPress={() => setViewer(null)} />
          {/* content_type from the server determines which fullscreen renderer to use for the selected evidence item. */}
          {viewer && (
            viewer.contentType.startsWith('video/')
              ? <EvidenceVideo fireId={viewer.fireId} imageId={viewer.imageId} />
              : (
                <Image
                  source={evidenceSource(viewer.fireId, viewer.imageId)}
                  style={{ width: '100%', height: '80%' }}
                  contentFit="contain"
                  transition={150}
                />
              )
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
              onPress={() => saveEvidence(viewer.fireId, viewer.imageId, viewer.contentType)}
              disabled={saving}
              hitSlop={8}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Ionicons name="download-outline" size={20} color="#fff" />}
              <Text className="font-sans-medium text-white">{saving ? 'กำลังบันทึก...' : 'บันทึกไฟล์'}</Text>
            </Pressable>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}
