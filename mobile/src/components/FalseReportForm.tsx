import SlideUpModal from '@/components/SlideUpModal'
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

export default function FalseReportForm({
  visible,
  onClose,
  note,
  onNoteChange,
  submitting,
  onSubmit,
  keyboardHeight,
}: {
  visible: boolean
  onClose: () => void
  note: string
  onNoteChange: (value: string) => void
  submitting: boolean
  onSubmit: () => void
  keyboardHeight: number
}) {
  return (
    <SlideUpModal
      visible={visible}
      onClose={onClose}
      dismissable={!submitting}
      sheetStyle={{ marginBottom: keyboardHeight, maxHeight: '90%' }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text className="mb-3 text-xl self-center font-sans-semibold text-accent">แจ้งว่าไม่ใช่ไฟ</Text>
        <Text className="mb-1 text-md text-center font-head text-accent">
          ใช้เฉพาะเมื่อตรวจสอบแล้วพบว่าไม่มีไฟจริงในจุดนี้
        </Text>

        <Text className="mb-0.5 mt-2 text-md font-head text-gray-500">หมายเหตุ (ไม่บังคับ)</Text>
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder="เหตุผลหรือรายละเอียดเพิ่มเติม..."
          multiline
          maxLength={2000}
          editable={!submitting}
          className="min-h-20 rounded-md border border-border p-2.5 text-sm font-sans text-card-foreground"
          style={{ textAlignVertical: 'top' }}
        />

        <View className="mt-5 flex-row gap-3">
          <TouchableOpacity
            className="flex-1 items-center rounded-xl border-2 border-border p-3.5"
            onPress={onClose}
            disabled={submitting}
          >
            <Text className="text-lg font-sans-semibold text-gray-500">ยกเลิก</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`items-center rounded-xl p-3.5 ${submitting ? 'bg-gray-300' : 'bg-gray-500'}`}
            style={{ flex: 2 }}
            onPress={onSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-lg font-sans-semibold text-white">ยืนยันว่าไม่ใช่ไฟ</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SlideUpModal>
  )
}
