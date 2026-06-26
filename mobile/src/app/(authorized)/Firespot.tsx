import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  Alert,
  TouchableOpacity,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Animated, { SlideInDown } from 'react-native-reanimated'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useFireStore, type ResolvePhoto } from '@/stores/fireStore'
import { formatDetectedAt } from '@/utils/format'
import { colors } from '@/lib/theme'

// Map's "free/burning" red, kept literal so the active-fire icon/badge here match
// the map markers (FIRE_COLORS.free in MapView).
const BURNING = '#ef4444'

// shadow can't be expressed as a className faithfully on both platforms — keep it inline
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}

const MAX_PHOTOS = 3

function gpsFromExif(exif: Record<string, any> | null | undefined): ResolvePhoto['gps'] {
  if (!exif) return null
  let lat = exif.GPSLatitude
  let lng = exif.GPSLongitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (exif.GPSLatitudeRef === 'S' && lat > 0) lat = -lat
  if (exif.GPSLongitudeRef === 'W' && lng > 0) lng = -lng
  return { latitude: lat, longitude: lng }
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
  const [submitting, setSubmitting] = useState(false)
  const [falseFormVisible, setFalseFormVisible] = useState(false)
  const [falseNote, setFalseNote] = useState('')
  const [falseSubmitting, setFalseSubmitting] = useState(false)
  // fallback GPS for photos without EXIF coordinates (e.g. library picks)
  const deviceGps = useRef<ResolvePhoto['gps']>(null)

  useEffect(() => {
    loadReservedFire()
  }, [loadReservedFire])

  const openResolveForm = useCallback(() => {
    setNote('')
    setPhotos([])
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
      Alert.alert('ไม่สามารถถ่ายรูปได้', 'กรุณาอนุญาตให้แอปใช้กล้อง')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('ไม่สามารถเลือกรูปได้', 'กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const removePhoto = useCallback((uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri))
  }, [])

  const submitResolve = useCallback(async () => {
    if (photos.length === 0) {
      Alert.alert('ต้องแนบรูปถ่าย', 'กรุณาถ่ายรูปหลักฐานการดับไฟอย่างน้อย 1 รูป')
      return
    }
    setSubmitting(true)
    try {
      await resolveFire(note, photos)
      setFormVisible(false)
    } catch (e) {
      Alert.alert(
        'ไม่สำเร็จ',
        e instanceof Error ? e.message : 'ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSubmitting(false)
    }
  }, [note, photos, resolveFire])

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
            Alert.alert('ไม่สำเร็จ', e instanceof Error ? e.message : 'ไม่สามารถยกเลิกการจองได้')
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
      Alert.alert(
        'ไม่สำเร็จ',
        e instanceof Error ? e.message : 'ไม่สามารถรายงานว่าไม่ใช่ไฟได้ กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setFalseSubmitting(false)
    }
  }, [falseNote, reportFalseFire])

  if (!reservedFire) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Ionicons name="flame-outline" size={48} color={colors.gray300} />
        <Text className="mt-3 text-base font-sans-semibold text-gray-500">ยังไม่มีไฟที่จอง</Text>
        <Text className="mt-1 text-center text-[13px] font-head text-gray-400">กดปุ่ม "จอง" ในรายการไฟบนแผนที่เพื่อรับผิดชอบไฟ</Text>
      </View>
    )
  }

  const isFalse = reservedFire.status && reservedFire.false_alarm
  const statusLabel = isFalse ? 'ไม่ใช่ไฟ' : reservedFire.status ? 'ดับแล้ว' : 'กำลังไหม้'

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, paddingTop: 48 }}>
      <View className="mb-4 flex-row items-center">
        <Ionicons
          name={isFalse ? 'close-circle' : reservedFire.status ? 'checkmark-circle' : 'flame'}
          size={28}
          color={isFalse ? colors.gray500 : reservedFire.status ? colors.success : BURNING}
        />
        <Text className="ml-2 shrink text-xl font-sans-bold text-accent">{reservedFire.name}</Text>
        <View
          className={`ml-auto rounded-full px-2.5 py-[3px] ${
            isFalse ? 'bg-gray-500' : reservedFire.status ? 'bg-success' : 'bg-[#ef4444]'
          }`}
        >
          <Text className="text-xs font-sans-semibold text-white">{statusLabel}</Text>
        </View>
      </View>

      {/* how this fire became yours: dispatcher-appointed vs self-reserved */}
      <View
        className={`mb-3 flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${
          reservedFire.appointed ? 'bg-[#e0e7ff]' : 'bg-[#e0f2fe]'
        }`}
      >
        <Ionicons
          name={reservedFire.appointed ? 'person-circle-outline' : 'hand-left-outline'}
          size={14}
          color={reservedFire.appointed ? '#4338ca' : '#0369a1'}
        />
        <Text
          className="text-xs font-sans-semibold"
          style={{ color: reservedFire.appointed ? '#4338ca' : '#0369a1' }}
        >
          {reservedFire.appointed ? 'มอบหมายโดยผู้ควบคุม' : 'จองเอง'}
        </Text>
      </View>

      <View className="rounded-2xl bg-foreground px-4" style={cardShadow}>
        <Row label="ตรวจพบเมื่อ" value={formatDetectedAt(reservedFire.detected_at)} />
        <Row label="สถานะ" value={statusLabel} />
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

      {!reservedFire.status && (
        <>
          <TouchableOpacity
            className={`mt-4 flex-row items-center justify-center rounded-xl py-3.5 ${!online ? 'bg-gray-300' : 'bg-success'}`}
            disabled={!online}
            onPress={openResolveForm}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
            <Text className="ml-2 text-base font-sans-semibold text-white">ดับไฟแล้ว</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`mt-3 flex-row items-center justify-center rounded-xl border bg-foreground py-3.5 ${!online ? 'border-gray-200' : 'border-gray-300'}`}
            disabled={!online}
            onPress={openFalseForm}
          >
            <Ionicons name="close-circle-outline" size={20} color={online ? colors.gray500 : colors.gray300} />
            <Text className={`ml-2 text-base font-sans-semibold ${!online ? 'text-gray-300' : 'text-gray-500'}`}>
              ไม่ใช่ไฟ (แจ้งเตือนผิดพลาด)
            </Text>
          </TouchableOpacity>
          {/* self-reserved fires can be released; dispatcher-appointed ones cannot */}
          {!reservedFire.appointed && (
            <TouchableOpacity
              className="mt-3 flex-row items-center justify-center rounded-xl border border-[#FECACA] bg-foreground py-3.5"
              onPress={confirmCancel}
              disabled={cancelling}
            >
              <Ionicons name="arrow-undo-outline" size={20} color={colors.destructive} />
              <Text className="ml-2 text-base font-sans-semibold text-destructive">
                {cancelling ? 'กำลังยกเลิก…' : 'ยกเลิกการจอง'}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <Text className="mt-3 text-center text-xs font-head text-gray-400">
        {reservedFire.status
          ? isFalse
            ? 'รายงานว่าไม่ใช่ไฟเรียบร้อยแล้ว คุณสามารถจองจุดไฟใหม่ได้จากแผนที่'
            : 'ดับไฟเรียบร้อยแล้ว คุณสามารถจองจุดไฟใหม่ได้จากแผนที่'
          : online
            ? 'เจ้าหน้าที่ 1 คน จองได้ครั้งละ 1 จุดไฟ ต้องดับไฟเดิมหรือแจ้งว่าไม่ใช่ไฟก่อนจึงจะจองจุดใหม่ได้'
            : 'คุณอยู่ในสถานะออฟไลน์ ต้องออนไลน์ก่อนจึงจะบันทึกผลได้'}
      </Text>

      <Modal
        visible={formVisible}
        animationType="none"
        transparent
        onRequestClose={() => !submitting && setFormVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/40"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* tapping outside the card dismisses (blocked while submitting) */}
          <Pressable
            className="absolute inset-0"
            onPress={() => !submitting && setFormVisible(false)}
          />
          <Animated.View className="rounded-t-3xl bg-foreground p-5 pb-8" entering={SlideInDown.duration(250)}>
            <Text className="mb-3 text-lg font-sans-bold text-accent">บันทึกการดับไฟ</Text>

            <Text className="mb-1.5 mt-2 text-[13px] font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="รายละเอียดเพิ่มเติม..."
              multiline
              maxLength={2000}
              editable={!submitting}
              className="min-h-[72px] rounded-[10px] border border-border p-2.5 text-sm font-sans text-card-foreground"
              style={{ textAlignVertical: 'top' }}
            />

            <Text className="mb-1.5 mt-2 text-[13px] font-head text-gray-500">
              รูปถ่ายหลักฐาน (อย่างน้อย 1 รูป สูงสุด {MAX_PHOTOS} รูป)
            </Text>
            <View className="mt-1 flex-row gap-2.5">
              {photos.map((p) => (
                <View key={p.uri} className="relative">
                  <Image source={{ uri: p.uri }} className="h-[72px] w-[72px] rounded-[10px] bg-muted" />
                  <TouchableOpacity
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-[10px] bg-destructive"
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
                    className="h-[72px] w-[72px] items-center justify-center rounded-[10px] border border-dashed border-border"
                    onPress={takePhoto}
                    disabled={submitting}
                  >
                    <Ionicons name="camera-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-[11px] font-head text-gray-500">ถ่ายรูป</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="h-[72px] w-[72px] items-center justify-center rounded-[10px] border border-dashed border-border"
                    onPress={pickPhoto}
                    disabled={submitting}
                  >
                    <Ionicons name="images-outline" size={22} color={colors.gray500} />
                    <Text className="mt-0.5 text-[11px] font-head text-gray-500">คลังภาพ</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                className="flex-1 items-center rounded-xl border border-border p-3.5"
                onPress={() => setFormVisible(false)}
                disabled={submitting}
              >
                <Text className="text-[15px] font-sans-semibold text-gray-500">ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`items-center rounded-xl p-3.5 ${photos.length === 0 || submitting ? 'bg-gray-300' : 'bg-success'}`}
                style={{ flex: 2 }}
                onPress={submitResolve}
                disabled={photos.length === 0 || submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-[15px] font-sans-semibold text-white">ยืนยันการดับไฟ</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={falseFormVisible}
        animationType="none"
        transparent
        onRequestClose={() => !falseSubmitting && setFalseFormVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/40"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="absolute inset-0"
            onPress={() => !falseSubmitting && setFalseFormVisible(false)}
          />
          <Animated.View className="rounded-t-3xl bg-foreground p-5 pb-8" entering={SlideInDown.duration(250)}>
            <Text className="mb-3 text-lg font-sans-bold text-accent">แจ้งว่าไม่ใช่ไฟ</Text>
            <Text className="mb-1 text-[13px] font-head leading-[19px] text-gray-500">
              ใช้เมื่อตรวจสอบแล้วพบว่าไม่มีไฟจริงในจุดนี้ (การแจ้งเตือนผิดพลาด) ไม่ต้องแนบรูปถ่าย
            </Text>

            <Text className="mb-1.5 mt-2 text-[13px] font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
            <TextInput
              value={falseNote}
              onChangeText={setFalseNote}
              placeholder="เหตุผลหรือรายละเอียดเพิ่มเติม..."
              multiline
              maxLength={2000}
              editable={!falseSubmitting}
              className="min-h-[72px] rounded-[10px] border border-border p-2.5 text-sm font-sans text-card-foreground"
              style={{ textAlignVertical: 'top' }}
            />

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                className="flex-1 items-center rounded-xl border border-border p-3.5"
                onPress={() => setFalseFormVisible(false)}
                disabled={falseSubmitting}
              >
                <Text className="text-[15px] font-sans-semibold text-gray-500">ยกเลิก</Text>
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
                  <Text className="text-[15px] font-sans-semibold text-white">ยืนยันว่าไม่ใช่ไฟ</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="flex-row justify-between border-b border-border py-3">
      <Text className="text-sm font-head text-gray-500">{label}</Text>
      <Text className="ml-4 shrink text-right text-sm font-sans-medium text-card-foreground">{value ?? '-'}</Text>
    </View>
  )
}
