import SlideUpModal from '@/components/SlideUpModal'
import { EVIDENCE_MAX_PHOTOS, type EvidenceCapture } from '@/hooks/useEvidenceCapture'
import { colors } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

// The "record a resolution" bottom sheet: optional note plus photo/video evidence.
// Purely presentational — the note lives with the caller, the media with `capture`.
export default function ResolveEvidenceForm({
  visible,
  onClose,
  note,
  onNoteChange,
  submitting,
  onSubmit,
  keyboardHeight,
  capture,
}: {
  visible: boolean
  onClose: () => void
  note: string
  onNoteChange: (value: string) => void
  submitting: boolean
  onSubmit: () => void
  keyboardHeight: number
  capture: EvidenceCapture
}) {
  const { photos, video, compressingVideo, takePhoto, pickPhoto, removePhoto, removeVideo, captureVideo } = capture
  return (
    <SlideUpModal
      visible={visible}
      onClose={onClose}
      dismissable={!submitting}
      sheetStyle={{ marginBottom: keyboardHeight, maxHeight: '90%' }}
    >
      {/* keyboardShouldPersistTaps: without it the first tap on a button just
          dismisses the keyboard (needs a second tap) when the note field is focused */}
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text className="mb-3 text-xl self-center font-sans-semibold text-accent">บันทึกการดับไฟ</Text>

        <Text className="mb-0.5 mt-2 text-md font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder="รายละเอียดเพิ่มเติม..."
          multiline
          maxLength={2000}
          editable={!submitting}
          className="min-h-20 rounded-md border border-border p-2.5 text-sm font-sans text-card-foreground"
          style={{ textAlignVertical: 'top' }}
        />

        <Text className="mb-0.5 mt-2 text-sm font-head text-gray-500">
          รูปถ่ายหลักฐาน (สูงสุด {EVIDENCE_MAX_PHOTOS} รูป — แนบรูปหรือวิดีโออย่างน้อย 1 รายการ)
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
          {photos.length < EVIDENCE_MAX_PHOTOS && (
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
                onPress={removeVideo}
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
            onPress={onClose}
            disabled={submitting}
          >
            <Text className="text-lg font-sans-semibold text-gray-500">ยกเลิก</Text>
          </TouchableOpacity>
          {/* not blockaded by missing evidence — onSubmit validates and
              toasts why; only disabled while actually working (in-flight / compressing) */}
          <TouchableOpacity
            className={`items-center rounded-xl p-3.5 ${submitting || compressingVideo ? 'bg-gray-300' : 'bg-success'}`}
            style={{ flex: 2 }}
            onPress={onSubmit}
            disabled={submitting || compressingVideo}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-lg font-sans-semibold text-white">ยืนยันการดับไฟ</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SlideUpModal>
  )
}
