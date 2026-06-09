import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import { fetchProvinces, Province, useAuthSession } from '@/providers/AuthProvider'

export default function Register() {
  const { signUp, signIn } = useAuthSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [provinces, setProvinces] = useState<Province[]>([])
  const [province, setProvince] = useState<Province | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchProvinces().then(setProvinces)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return provinces
    return provinces.filter(
      (p) => p.name_th.toLowerCase().includes(q) || (p.name_en ?? '').toLowerCase().includes(q),
    )
  }, [provinces, query])

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
      await signUp(email.trim(), password, province.id, name.trim())
      await signIn(email.trim(), password) // -> gate routes to /Pending until admin verifies
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สมัครสมาชิกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  const input = { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 } as const

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 24, gap: 12 }}>
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

        <Text>จังหวัด {province ? `· เลือก: ${province.name_th}` : ''}</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="ค้นหาจังหวัด..." style={input} />
        <View style={{ height: 160, borderWidth: 1, borderColor: '#eee', borderRadius: 8 }}>
          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setProvince(item)}
                style={{
                  padding: 12,
                  backgroundColor: province?.id === item.id ? '#dbeafe' : 'white',
                  borderBottomWidth: 1,
                  borderBottomColor: '#f0f0f0',
                }}
              >
                <Text>{item.name_th}</Text>
              </Pressable>
            )}
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
      </View>
    </SafeAreaView>
  )
}