import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import { Dropdown } from 'react-native-element-dropdown'
import { Province, useAuthSession } from '@/providers/AuthProvider'
import PROVINCES from '@/data/provinces.json'

export default function Register() {
  const { signUp, signIn } = useAuthSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [province, setProvince] = useState<Province | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)


  const onSubmit = async () => {
    if (submitting) return
    setError(null)
    if (!name.trim()) return setError('กรุณากรอกชื่อ-นามสกุล')
    if (!email || !password) return setError('กรุณากรอกอีเมลและรหัสผ่าน')
    if (password.length < 8) return setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
    if (password !== confirm) return setError('รหัสผ่านไม่ตรงกัน')
    if (!province) return setError('กรุณาเลือกจังหวัด')
    setSubmitting(true)
    try {
      await signUp(email.trim(), password, province.code, name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สมัครสมาชิกไม่สำเร็จ')
      setSubmitting(false)
      return
    }
    try {
      await signIn(email.trim(), password) // -> gate routes to /Pending until admin verifies
    } catch {
      // registered fine but auto-login failed (e.g. network blip)
      setError('สมัครสมาชิกสำเร็จแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่สำเร็จ กรุณาเข้าสู่ระบบด้วยตนเอง')
    } finally {
      setSubmitting(false)
    }
  }

  const input = { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 } as const

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontWeight: '600' }}>สมัครสมาชิก (เจ้าหน้าที่ภาคสนาม)</Text>

        <Text>ชื่อ-นามสกุล</Text>
        <TextInput value={name} onChangeText={setName} placeholder="ชื่อ นามสกุล"
          autoCapitalize="words" autoCorrect={false} style={input} />

        <Text>อีเมล</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="email@example.com"
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={input} />

        <Text>รหัสผ่าน</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••"
          autoCapitalize="none" style={input} />

        <Text>ยืนยันรหัสผ่าน</Text>
        <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="••••••••"
          autoCapitalize="none" style={input} />

        <View style={{ zIndex: 999 }}>
        <Text>จังหวัด</Text>
        <Dropdown
          data={PROVINCES}
          labelField="name_th"
          valueField="id"
          placeholder="เลือกจังหวัด..."
          search
          searchPlaceholder="ค้นหาจังหวัด..."
          value={province?.id ?? null}
          onChange={(item) => setProvince(item)}
          style={input}
          selectedTextStyle={{ fontSize: 14 }}
          placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
          inputSearchStyle={{ fontSize: 14, borderRadius: 6 }}
        />
        </View>

        {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}

        <Pressable onPress={onSubmit} disabled={submitting}
          style={{ backgroundColor: submitting ? '#93c5fd' : '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' }}>
          {submitting ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '600' }}>สมัครสมาชิก</Text>}
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
          <Text>มีบัญชีอยู่แล้ว?</Text>
          <Link href="/Login" style={{ color: '#2563eb', fontWeight: '600' }}>เข้าสู่ระบบ</Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}