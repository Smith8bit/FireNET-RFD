import FalseReportForm from '@/components/FalseReportForm'
import ResolveEvidenceForm from '@/components/ResolveEvidenceForm'
import { useEvidenceCapture } from '@/hooks/useEvidenceCapture'
import { colors } from '@/lib/theme'
import { toast } from '@/lib/toastStore'
import { useFireStore } from '@/stores/fireStore'
import { formatDetectedAt } from '@/utils/format'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Keyboard,
  Linking,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'

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
  const [submitting, setSubmitting] = useState(false)
  const [falseFormVisible, setFalseFormVisible] = useState(false)
  const [falseNote, setFalseNote] = useState('')
  const [falseSubmitting, setFalseSubmitting] = useState(false)
  const capture = useEvidenceCapture()
  const { reset: resetEvidence, photos, video } = capture
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
    resetEvidence()
    setFormVisible(true)
  }, [resetEvidence])

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

      <ResolveEvidenceForm
        visible={formVisible}
        onClose={() => setFormVisible(false)}
        note={note}
        onNoteChange={setNote}
        submitting={submitting}
        onSubmit={submitResolve}
        keyboardHeight={keyboardHeight}
        capture={capture}
      />

      <FalseReportForm
        visible={falseFormVisible}
        onClose={() => setFalseFormVisible(false)}
        note={falseNote}
        onNoteChange={setFalseNote}
        submitting={falseSubmitting}
        onSubmit={submitFalseReport}
        keyboardHeight={keyboardHeight}
      />
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
