import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import { useAuthSession } from '@/providers/AuthProvider'

export default function Register() {
  const { signUp, signIn } = useAuthSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async () => {
    if (submitting) return
    setError(null)
    if (!email || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน')
      return
    }
    if (password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      return
    }
    if (password !== confirm) {
      setError('รหัสผ่านไม่ตรงกัน')
      return
    }
    setSubmitting(true)
    try {
      await signUp(email.trim(), password)
      await signIn(email.trim(), password) // auto-login → redirects into (authorized)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สมัครสมาชิกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '600' }}>สมัครสมาชิก (เจ้าหน้าที่ภาคสนาม)</Text>

        <View style={{ gap: 6 }}>
          <Text>อีเมล</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="email@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text>รหัสผ่าน</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={passwordHidden}
            textContentType="newPassword"
            placeholder="••••••••"
            autoCapitalize="none"
            style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text>ยืนยันรหัสผ่าน</Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={passwordHidden}
            textContentType="newPassword"
            placeholder="••••••••"
            autoCapitalize="none"
            style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 }}
          />
          <Pressable onPress={() => setPasswordHidden((v) => !v)}>
            <Text style={{ color: '#2563eb' }}>{passwordHidden ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน'}</Text>
          </Pressable>
        </View>

        {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}

        <TouchableOpacity
          onPress={onSubmit}
          disabled={submitting}
          style={{
            backgroundColor: submitting ? '#93c5fd' : '#2563eb',
            padding: 14,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {submitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: 'white', fontWeight: '600' }}>สมัครสมาชิก</Text>
          )}
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
          <Text>มีบัญชีอยู่แล้ว?</Text>
          <Link href="/Login" style={{ color: '#2563eb', fontWeight: '600' }}>เข้าสู่ระบบ</Link>
        </View>
      </View>
    </SafeAreaView>
  )
}