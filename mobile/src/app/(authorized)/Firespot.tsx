import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
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
  const online = useFireStore((s) => s.online)

  const [formVisible, setFormVisible] = useState(false)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<ResolvePhoto[]>([])
  const [submitting, setSubmitting] = useState(false)
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

  if (!reservedFire) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="flame-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>ยังไม่มีไฟที่จอง</Text>
        <Text style={styles.emptyHint}>กดปุ่ม "จอง" ในรายการไฟบนแผนที่เพื่อรับผิดชอบไฟ</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Ionicons
          name={reservedFire.status ? 'checkmark-circle' : 'flame'}
          size={28}
          color={reservedFire.status ? '#10b981' : '#ef4444'}
        />
        <Text style={styles.title}>{reservedFire.name}</Text>
        <View style={[styles.badge, reservedFire.status ? styles.badgeResolved : styles.badgeActive]}>
          <Text style={styles.badgeText}>{reservedFire.status ? 'ดับแล้ว' : 'กำลังไหม้'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Row label="ตรวจพบเมื่อ" value={formatDetectedAt(reservedFire.detected_at)} />
        <Row label="สถานะ" value={reservedFire.status ? 'ดับแล้ว' : 'กำลังไหม้'} />
        <Row label="ประเภท" value={reservedFire.type} />
        <Row label="ตำบล" value={reservedFire.tumboon} />
        <Row label="อำเภอ" value={reservedFire.aumper} />
        <Row label="จังหวัด" value={reservedFire.province} />
        <Row
          label="พิกัด"
          value={`${reservedFire.lat.toFixed(5)}, ${reservedFire.lng.toFixed(5)}`}
        />
      </View>

      {!reservedFire.status && (
        <TouchableOpacity
          style={[styles.resolveButton, !online && styles.resolveButtonDisabled]}
          disabled={!online}
          onPress={openResolveForm}
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
          <Text style={styles.resolveButtonText}>ดับไฟแล้ว</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.note}>
        {reservedFire.status
          ? 'ดับไฟเรียบร้อยแล้ว คุณสามารถจองจุดไฟใหม่ได้จากแผนที่'
          : online
            ? 'เจ้าหน้าที่ 1 คน จองได้ครั้งละ 1 จุดไฟ ต้องดับไฟเดิมก่อนจึงจะจองจุดใหม่ได้'
            : 'คุณอยู่ในสถานะออฟไลน์ ต้องออนไลน์ก่อนจึงจะบันทึกการดับไฟได้'}
      </Text>

      <Modal
        visible={formVisible}
        animationType="none"
        transparent
        onRequestClose={() => !submitting && setFormVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* tapping outside the card dismisses (blocked while submitting) */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !submitting && setFormVisible(false)}
          />
          <Animated.View style={styles.modalCard} entering={SlideInDown.duration(250)}>
            <Text style={styles.modalTitle}>บันทึกการดับไฟ</Text>

            <Text style={styles.modalLabel}>หมายเหตุ (ไม่บังคับ)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="รายละเอียดเพิ่มเติม..."
              multiline
              maxLength={2000}
              editable={!submitting}
              style={styles.noteInput}
            />

            <Text style={styles.modalLabel}>
              รูปถ่ายหลักฐาน (อย่างน้อย 1 รูป สูงสุด {MAX_PHOTOS} รูป)
            </Text>
            <View style={styles.photoRow}>
              {photos.map((p) => (
                <View key={p.uri} style={styles.photoWrap}>
                  <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => removePhoto(p.uri)}
                    disabled={submitting}
                  >
                    <Ionicons name="close" size={14} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <TouchableOpacity style={styles.photoAdd} onPress={takePhoto} disabled={submitting}>
                    <Ionicons name="camera-outline" size={22} color="#6b7280" />
                    <Text style={styles.photoAddText}>ถ่ายรูป</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto} disabled={submitting}>
                    <Ionicons name="images-outline" size={22} color="#6b7280" />
                    <Text style={styles.photoAddText}>คลังภาพ</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setFormVisible(false)}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmit,
                  (photos.length === 0 || submitting) && styles.resolveButtonDisabled,
                ]}
                onPress={submitResolve}
                disabled={photos.length === 0 || submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalSubmitText}>ยืนยันการดับไฟ</Text>
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
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? '-'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 16,
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
    flexShrink: 1,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 'auto',
  },
  badgeActive: {
    backgroundColor: '#ef4444',
  },
  badgeResolved: {
    backgroundColor: '#10b981',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  resolveButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  resolveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  note: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 6,
    marginTop: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 10,
    minHeight: 72,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  photoWrap: {
    position: 'relative',
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
  },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddText: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '600',
  },
  modalSubmit: {
    flex: 2,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
})
