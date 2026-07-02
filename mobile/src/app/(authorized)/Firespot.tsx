import { colors } from '@/lib/theme'
import { toast } from '@/lib/toastStore'
import { useFireStore, type ResolvePhoto } from '@/stores/fireStore'
import { formatDetectedAt } from '@/utils/format'
import { Ionicons } from '@expo/vector-icons'
import { File } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Video } from 'react-native-compressor'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { SlideInDown } from 'react-native-reanimated'

// Map's "free/burning" red, kept literal so the active-fire icon/badge here match
// the map markers (FIRE_COLORS.free in MapView).
const BURNING = '#ef4444'

const MAX_PHOTOS = 3
const VIDEO_MAX_MB = 40 // keep in sync with backend RESOLVE_MAX_VIDEO_MB

function gpsFromExif(exif: Record<string, any> | null | undefined): ResolvePhoto['gps'] {
  if (!exif) return null
  let lat = exif.GPSLatitude
  let lng = exif.GPSLongitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (exif.GPSLatitudeRef === 'S' && lat > 0) lat = -lat
  if (exif.GPSLongitudeRef === 'W' && lng > 0) lng = -lng
  return { latitude: lat, longitude: lng }
}

// React Native's Modal renders in its own native window on Android that doesn't
// resize for the keyboard, so KeyboardAvoidingView has nothing to push against.
// Track the keyboard height from the global Keyboard events instead.
function useKeyboardHeight() {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}

export default function Firespot() {
  const reservedFire = useFireStore((s) => s.reservedFire)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const resolveFire = useFireStore((s) => s.resolveFire)
  const reportFalseFire = useFireStore((s) => s.reportFalseFire)
  const cancelReservation = useFireStore((s) => s.cancelReservation)
  const online = useFireStore((s) => s.online)
  const [cancelling, setCancelling] = useState(false)

  const [formVisible, setFormVisible] = useState(false)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<ResolvePhoto[]>([])
  const [video, setVideo] = useState<ResolvePhoto | null>(null)
  const [compressingVideo, setCompressingVideo] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [falseFormVisible, setFalseFormVisible] = useState(false)
  const [falseNote, setFalseNote] = useState('')
  const [falseSubmitting, setFalseSubmitting] = useState(false)
  // fallback GPS for photos without EXIF coordinates (e.g. library picks)
  const deviceGps = useRef<ResolvePhoto['gps']>(null)
  const keyboardHeight = useKeyboardHeight()

  useEffect(() => {
    loadReservedFire()
  }, [loadReservedFire])

  // open Google Maps turn-by-turn navigation to the fire. On Android the
  // google.navigation: scheme launches directions straight into the Google Maps
  // app; everywhere else the universal maps URL opens the app (or the browser).
  const navigate = useCallback(() => {
    if (!reservedFire) return
    const { lat, lng } = reservedFire
    const universal = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    const url = Platform.OS === 'android' ? `google.navigation:q=${lat},${lng}` : universal
    Linking.openURL(url).catch(() =>
      Linking.openURL(universal).catch(() =>
        toast.error('ไม่พบแอปแผนที่บนอุปกรณ์นี้'),
      ),
    )
  }, [reservedFire])

  const openResolveForm = useCallback(() => {
    setNote('')
    setPhotos([])
    setVideo(null)
    setFormVisible(true)
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((pos) => {
        deviceGps.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      })
      .catch(() => {
        deviceGps.current = null
      })
  }, [])

  const addAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    // read EXIF GPS before compressing — re-encoding drops it
    const gps = gpsFromExif(asset.exif) ?? deviceGps.current
    const small = await manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
    })
    setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, { uri: small.uri, gps }]))
  }, [])

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปใช้กล้อง')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const removePhoto = useCallback((uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri))
  }, [])

  // one optional video clip; compressed before upload, GPS falls back to device fix
  const captureVideo = useCallback(
    async (fromLibrary: boolean) => {
      const perm = fromLibrary
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync()
      if (perm.status !== 'granted') {
        toast.error(fromLibrary ? 'กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ' : 'กรุณาอนุญาตให้แอปใช้กล้อง')
        return
      }
      const opts = { mediaTypes: 'videos' as const }
      const result = fromLibrary
        ? await ImagePicker.launchImageLibraryAsync(opts)
        : await ImagePicker.launchCameraAsync(opts)
      if (result.canceled || !result.assets[0]) return
      setCompressingVideo(true)
      try {
        // manual/HD: cap the longest side at 720p so clips stay legible but small
        const compressed = await Video.compress(result.assets[0].uri, { compressionMethod: 'manual', maxSize: 1280 })
        // backend rejects > VIDEO_MAX_MB; check here so the officer isn't stuck at upload time
        if (new File(compressed).size > VIDEO_MAX_MB * 1024 * 1024) {
          toast.error(`วิดีโอใหญ่เกินไป (สูงสุด ${VIDEO_MAX_MB}MB) กรุณาถ่ายให้สั้นลง`)
          return
        }
        const thumb = await VideoThumbnails.getThumbnailAsync(compressed).catch(() => null)
        setVideo({ uri: compressed, gps: deviceGps.current, kind: 'video', thumbUri: thumb?.uri })
      } catch {
        toast.error('ไม่สามารถประมวลผลวิดีโอได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        setCompressingVideo(false)
      }
    },
    [],
  )

  const submitResolve = useCallback(async () => {
    if (photos.length === 0 && !video) {
      toast.error('กรุณาแนบรูปถ่ายหรือวิดีโอหลักฐานอย่างน้อย 1 รายการ')
      return
    }
    setSubmitting(true)
    try {
      await resolveFire(note, video ? [...photos, video] : photos)
      setFormVisible(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }, [note, photos, video, resolveFire])

  const confirmCancel = useCallback(() => {
    Alert.alert('ยกเลิกการจอง', 'ต้องการยกเลิกการจองไฟนี้ใช่หรือไม่? ไฟจะกลับไปให้ผู้อื่นรับผิดชอบได้', [
      { text: 'ไม่ใช่', style: 'cancel' },
      {
        text: 'ยกเลิกการจอง',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true)
          try {
            await cancelReservation()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'ไม่สามารถยกเลิกการจองได้')
          } finally {
            setCancelling(false)
          }
        },
      },
    ])
  }, [cancelReservation])

  const openFalseForm = useCallback(() => {
    setFalseNote('')
    setFalseFormVisible(true)
  }, [])

  const submitFalseReport = useCallback(async () => {
    setFalseSubmitting(true)
    try {
      await reportFalseFire(falseNote)
      setFalseFormVisible(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ไม่สามารถรายงานว่าไม่ใช่ไฟได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setFalseSubmitting(false)
    }
  }, [falseNote, reportFalseFire])

  if (!reservedFire) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <StatusBar style="dark" />
        <Ionicons name="flame-outline" size={48} color={colors.gray400} />
        <Text className="mt-3 text-base font-sans-semibold text-accent">ยังไม่มีไฟที่จอง</Text>
        <Text className="mt-1 text-center text-[13px] font-head text-gray-500">กดปุ่ม "จอง" ในรายการไฟบนแผนที่เพื่อรับผิดชอบไฟ</Text>
      </View>
    )
  }

  return (
    <ScrollView className="flex-1 bg-foreground" contentContainerStyle={{ padding: 16, paddingTop: 48 }}>
      <StatusBar style="dark" />
      <View className="mb-2 flex-row items-center bg-secondary p-3 rounded-full">
        <Ionicons name="flame-outline" size={28} color={'#FFFFFF'} />
        <Text className="ml-2 shrink text-xl font-sans-semibold text-white">{reservedFire.name}</Text>
        
        <View
          className={`ml-auto flex-row items-center gap-1 self-start rounded-full px-3 py-1.5 ${
            reservedFire.appointed ? 'bg-brand' : 'bg-white'
          }`}
        >
          <Ionicons
            name={reservedFire.appointed ? 'person-circle-outline' : 'hand-left-outline'}
            size={14}
            color={reservedFire.appointed ? '#FFFFFF' : '#6366f1'}
          />
          <Text
            className={`text-sm font-sans-semibold ${reservedFire.appointed ? 'text-white' : 'text-indigo-500'}`}
          >
            {reservedFire.appointed ? 'มอบหมายโดยผู้ดูแล' : 'จอง'}
          </Text>
        </View>
        
      </View>      

      <View className="bg-foreground p-2" >
        <Row label="ตรวจพบเมื่อ" value={formatDetectedAt(reservedFire.detected_at)} />
        <Row label="ประเภท" value={reservedFire.type} />
        <Row label="ตำบล" value={reservedFire.tumboon} />
        <Row label="อำเภอ" value={reservedFire.aumper} />
        <Row label="จังหวัด" value={reservedFire.province} />
        <Row label="ดาวเทียม" value={reservedFire.satellite} />
        <Row
          label="พิกัด"
          value={`${reservedFire.lat.toFixed(5)}, ${reservedFire.lng.toFixed(5)}`}
        />
      </View>

      <View className='mt-4 flex-1 gap-3'>
        <TouchableOpacity
          className="flex-row items-center justify-center rounded-full bg-blue-400 py-4"
          onPress={navigate}
        >
          <Ionicons name="navigate" size={20} color="#ffffff" />
          <Text className="ml-2 text-md font-sans-semibold text-white">นำทางด้วย Google Maps</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`flex-row items-center justify-center rounded-xl py-4 ${!online ? 'bg-gray-300' : 'bg-success'}`}
          disabled={!online}
          onPress={openResolveForm}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
          <Text className="ml-2 text-md font-sans-semibold text-white">ดับไฟแล้ว</Text>
        </TouchableOpacity>

        <View className='flex-row justify-between'>
          <TouchableOpacity
            className={` flex-row items-center justify-center rounded-xl border-2 bg-foreground py-3.5 ${!online ? 'border-gray-200' : 'border-gray-300'} ${!reservedFire.appointed ? 'w-64': 'w-full'}`}
            disabled={!online}
            onPress={openFalseForm}
          >
            <Ionicons name="close-circle-outline" size={20} color={online ? colors.gray500 : colors.gray300} />
            <Text className={`ml-2 text-md font-sans-semibold ${!online ? 'text-gray-300' : 'text-gray-500'}`}>
              ไม่ใช่ไฟ 
            </Text>
          </TouchableOpacity>

          {!reservedFire.appointed && (
            <TouchableOpacity
              className={`flex-row items-center justify-center rounded-xl border-2 w-1/3 bg-foreground py-3.5 ${!online ? 'border-gray-200' : 'border-destructive'} `}
              onPress={confirmCancel}
              disabled={cancelling || !online}
            >
              {!cancelling && (
                <Ionicons name="arrow-undo-outline" size={20} color={!online ? colors.gray300 : colors.destructive } />
              )}
              <Text className={`ml-2 text-md font-sans-semibold  ${!online ? 'text-gray-300' : 'text-destructive'}`}>
                {cancelling ? 'กำลังยกเลิก…' : 'ยกเลิก'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

      </View>      

      <Text className="mt-3 text-center text-xs font-head text-gray-500">
        {online
          ? 'จองได้ครั้งละ 1 จุดไฟ หากไฟถูกหมอบหมายให้ไม่สามารถยกเลิกได้'
          : 'คุณอยู่ในสถานะออฟไลน์ ต้องออนไลน์ก่อนจึงจะบันทึกผลได้'}
      </Text>

      <Modal
        visible={formVisible}
        animationType="none"
        transparent
        onRequestClose={() => !submitting && setFormVisible(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          {/* tapping outside the card dismisses (blocked while submitting) */}
          <Pressable
            className="absolute inset-0"
            onPress={() => !submitting && setFormVisible(false)}
          />
          <Animated.View
            className="rounded-t-3xl bg-foreground p-5"
            entering={SlideInDown.duration(250)}
            style={{ marginBottom: keyboardHeight, maxHeight: '90%' }}
          >
            {/* keyboardShouldPersistTaps: without it the first tap on a button just
                dismisses the keyboard (needs a second tap) when the note field is focused */}
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="mb-3 text-xl self-center font-sans-semibold text-accent">บันทึกการดับไฟ</Text>

            <Text className="mb-0.5 mt-2 text-md font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="รายละเอียดเพิ่มเติม..."
              multiline
              maxLength={2000}
              editable={!submitting}
              className="min-h-20 rounded-md border border-border p-2.5 text-sm font-sans text-card-foreground"
              style={{ textAlignVertical: 'top' }}
            />

            <Text className="mb-0.5 mt-2 text-sm font-head text-gray-500">
              รูปถ่ายหลักฐาน (สูงสุด {MAX_PHOTOS} รูป — แนบรูปหรือวิดีโออย่างน้อย 1 รายการ)
            </Text>
            <View className="mt-1 flex-row gap-2.5">
              {photos.map((p) => (
                <View key={p.uri} className="relative">
                  <Image source={{ uri: p.uri }} className="h-20 w-20 rounded-md bg-muted" />
                  <TouchableOpacity
                    className="absolute -right-1.5 -top-1.5 h-7 w-7 items-center justify-center rounded-full bg-destructive"
                    onPress={() => removePhoto(p.uri)}
                    disabled={submitting}
                  >
                    <Ionicons name="close" size={14} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <TouchableOpacity
                    className="h-20 w-20 items-center justify-center rounded-md border border-dashed border-border"
                    onPress={takePhoto}
                    disabled={submitting}
                  >
                    <Ionicons name="camera-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-sm font-head text-gray-500">ถ่ายรูป</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="h-20 w-20 items-center justify-center rounded-md border border-dashed border-border"
                    onPress={pickPhoto}
                    disabled={submitting}
                  >
                    <Ionicons name="images-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-sm font-head text-gray-500">คลังภาพ</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <Text className="mb-0.5 mt-3 text-sm font-head text-gray-500">
              วิดีโอหลักฐาน (ไม่บังคับ)
            </Text>
            <View className="mt-1 flex-row gap-2.5">
              {compressingVideo ? (
                <View className="h-20 w-20 items-center justify-center rounded-md border border-dashed border-border">
                  <ActivityIndicator color={colors.gray500} />
                  <Text className="mt-1 text-xs font-head text-gray-500">กำลังบีบอัด...</Text>
                </View>
              ) : video ? (
                <View className="relative">
                  <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-md bg-secondary">
                    {video.thumbUri ? (
                      <Image source={{ uri: video.thumbUri }} className="h-20 w-20" />
                    ) : null}
                    <View className="absolute inset-0 items-center justify-center">
                      <Ionicons name="play-circle" size={30} color="#ffffff" />
                    </View>
                  </View>
                  <TouchableOpacity
                    className="absolute -right-1.5 -top-1.5 h-7 w-7 items-center justify-center rounded-full bg-destructive"
                    onPress={() => setVideo(null)}
                    disabled={submitting}
                  >
                    <Ionicons name="close" size={14} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    className="h-20 w-20 items-center justify-center rounded-md border border-dashed border-border"
                    onPress={() => captureVideo(false)}
                    disabled={submitting}
                  >
                    <Ionicons name="videocam-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-sm font-head text-gray-500">ถ่ายวิดีโอ</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="h-20 w-20 items-center justify-center rounded-md border border-dashed border-border"
                    onPress={() => captureVideo(true)}
                    disabled={submitting}
                  >
                    <Ionicons name="film-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-sm font-head text-gray-500">คลังวิดีโอ</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                className="flex-1 items-center rounded-xl border-2 border-border p-3.5"
                onPress={() => setFormVisible(false)}
                disabled={submitting}
              >
                <Text className="text-lg font-sans-semibold text-gray-500">ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`items-center rounded-xl p-3.5 ${(photos.length === 0 && !video) || submitting || compressingVideo ? 'bg-gray-300' : 'bg-success'}`}
                style={{ flex: 2 }}
                onPress={submitResolve}
                disabled={(photos.length === 0 && !video) || submitting || compressingVideo}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-lg font-sans-semibold text-white">ยืนยันการดับไฟ</Text>
                )}
              </TouchableOpacity>
            </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={falseFormVisible}
        animationType="none"
        transparent
        onRequestClose={() => !falseSubmitting && setFalseFormVisible(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <Pressable
            className="absolute inset-0"
            onPress={() => !falseSubmitting && setFalseFormVisible(false)}
          />
          <Animated.View
            className="rounded-t-3xl bg-foreground p-5"
            entering={SlideInDown.duration(250)}
            style={{ marginBottom: keyboardHeight, maxHeight: '90%' }}
          >
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="mb-3 text-xl self-center font-sans-semibold text-accent">แจ้งว่าไม่ใช่ไฟ</Text>
            <Text className="mb-1 text-md text-center font-head text-accent">
              ใช้เฉพาะเมื่อตรวจสอบแล้วพบว่าไม่มีไฟจริงในจุดนี้
            </Text>

            <Text className="mb-0.5 mt-2 text-md font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
            <TextInput
              value={falseNote}
              onChangeText={setFalseNote}
              placeholder="เหตุผลหรือรายละเอียดเพิ่มเติม..."
              multiline
              maxLength={2000}
              editable={!falseSubmitting}
              className="min-h-20 rounded-md border border-border p-2.5 text-sm font-sans text-card-foreground"
              style={{ textAlignVertical: 'top' }}
            />

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                className="flex-1 items-center rounded-xl border-2 border-border p-3.5"
                onPress={() => setFalseFormVisible(false)}
                disabled={falseSubmitting}
              >
                <Text className="text-lg font-sans-semibold text-gray-500">ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`items-center rounded-xl p-3.5 ${falseSubmitting ? 'bg-gray-300' : 'bg-gray-500'}`}
                style={{ flex: 2 }}
                onPress={submitFalseReport}
                disabled={falseSubmitting}
              >
                {falseSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-lg font-sans-semibold text-white">ยืนยันว่าไม่ใช่ไฟ</Text>
                )}
              </TouchableOpacity>
            </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="flex-row  justify-between border-b border-border py-3">
      <Text className="text-md font-sans text-gray-500">{label}</Text>
      <Text className="shrink text-right text-md font-head-medium text-card-foreground">{value ?? '-'}</Text>
    </View>
  )
}
