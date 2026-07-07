import { api } from '@/lib/api'
import { apiErrorMessage } from '@/lib/apiError'
import { toast } from '@/lib/toastStore'
import { useAuthSession } from '@/providers/AuthProvider'
import LabeledInput from '@/components/LabeledInput'
import SaveButton from '@/components/SaveButton'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

/**
 * Account settings screen: edits profile fields (name, division) and
 * optionally changes the password in a single combined save.
 *
 * @returns the profile edit form; local field state is seeded from the current session and not kept in sync with later external updates
 */
export default function Account() {
  const { user, refresh } = useAuthSession()
  const [name, setName] = useState(user?.name ?? '')
  const [division, setDivision] = useState(user?.division ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // Password fields are optional: only validated/submitted if the user typed something,
  // so leaving them blank keeps the existing password untouched.
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
      // Profile and password are separate endpoints; profile always saves, password only when provided.
      await api.patch('/officers/me/profile', { name: name.trim(), division: division.trim() })
      if (password) {
        await api.patch('/users/me', { password })
        setPassword('')
        setConfirm('')
      }
      await refresh()
      toast.success('บันทึกข้อมูลแล้ว')
    } catch (e) {
      toast.error(apiErrorMessage(e, 'ไม่สามารถบันทึกข้อมูลได้'))
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

            <LabeledInput label="ชื่อ - นามสกุล" boxClassName="px-3 py-2" inputClassName="text-lg" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} />
            <LabeledInput label="สังกัด" boxClassName="px-3 py-2" inputClassName="text-lg" value={division} onChangeText={setDivision} autoCorrect={false} />

            <LabeledInput
              label="รหัสผ่านใหม่ (เว้นว่างหากไม่ต้องการเปลี่ยน)"
              boxClassName="px-3 py-2"
              inputClassName="text-lg"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={passwordHidden}
              textContentType="newPassword"
              autoCapitalize="none"
            />
            <LabeledInput
              label="ยืนยันรหัสผ่านใหม่"
              boxClassName="px-3 py-2"
              inputClassName="text-lg"
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
