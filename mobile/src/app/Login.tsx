import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import { useAuthSession } from '@/providers/AuthProvider'

export default function Login() {
  const { signIn } = useAuthSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async () => {
    if (submitting) return
    setError(null)
    if (!username || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }
    setSubmitting(true)
    try {
      await signIn(username.trim(), password) // AuthProvider redirects on success
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '600' }}>ระบบจัดการไฟป่า (หน่วยดับไฟ)</Text>

        <View style={{ gap: 6 }}>
          <Text>ชื่อผู้ใช้</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="ชื่อผู้ใช้"
            textContentType="username"
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
            textContentType="password"
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
            <Text style={{ color: 'white', fontWeight: '600' }}>เข้าสู่ระบบ</Text>
          )}
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
          <Text>ยังไม่มีบัญชี?</Text>
          <Link href="/Register" style={{ color: '#2563eb', fontWeight: '600' }}>สมัคร</Link>
        </View>
      </View>
    </SafeAreaView>
  )
}