import { api } from '@/lib/api'
import { toast } from '@/lib/toastStore'
import { useAuthSession } from '@/providers/AuthProvider'
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

function errMsg(e: any, fallback: string) {
  const d = e?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}

export default function Account() {
  const { user, refresh } = useAuthSession()
  const [name, setName] = useState(user?.name ?? '')
  const [division, setDivision] = useState(user?.division ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const saveAll = async () => {
    if (!name.trim()) {
      toast.error('กรุณากรอกชื่อ')
      return
    }
    if (password) {
      if (password.length < 8) {
        toast.error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
        return
      }
      if (password !== confirm) {
        toast.error('รหัสผ่านไม่ตรงกัน')
        return
      }
    }
    setBusy('save')
    try {
      await api.patch('/officers/me/profile', { name: name.trim(), division: division.trim() })
      if (password) {
        await api.patch('/users/me', { password })
        setPassword('')
        setConfirm('')
      }
      await refresh()
      toast.success('บันทึกข้อมูลแล้ว')
    } catch (e) {
      toast.error(errMsg(e, 'ไม่สามารถบันทึกข้อมูลได้'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-foreground" edges={['bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 28 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-4">
            <Text className="text-xl font-sans-semibold text-card-foreground">ข้อมูลบัญชี</Text>

            <LabeledInput label="ชื่อ - นามสกุล" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} />
            <LabeledInput label="สังกัด" value={division} onChangeText={setDivision} autoCorrect={false} />

            <LabeledInput
              label="รหัสผ่านใหม่ (เว้นว่างหากไม่ต้องการเปลี่ยน)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={passwordHidden}
              textContentType="newPassword"
              autoCapitalize="none"
            />
            <LabeledInput
              label="ยืนยันรหัสผ่านใหม่"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={passwordHidden}
              autoCapitalize="none"
            />
            <Pressable onPress={() => setPasswordHidden((v) => !v)} className="self-start">
              <Text className="text-primary">{passwordHidden ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน'}</Text>
            </Pressable>

            <SaveButton label="บันทึกข้อมูล" onPress={saveAll} loading={busy === 'save'} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// Filled, rounded field with a small label pinned to its top-left corner.
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl bg-background/40 px-3 py-2">
      <Text className="text-sm font-head text-muted-foreground">{label}</Text>
      {children}
    </View>
  )
}

// A FieldBox wrapping a TextInput — the input is transparent and unpadded so the
// box supplies the background, padding, and the top-left label.
function LabeledInput({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <FieldBox label={label}>
      <TextInput
        placeholderTextColor="#9ca3af"
        {...props}
        className="p-0 text-lg text-card-foreground"
        // Fixed height + no Android font padding so the box never reflows while typing.
        style={{ height: 34, includeFontPadding: false, textAlignVertical: 'center' }}
      />
    </FieldBox>
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
