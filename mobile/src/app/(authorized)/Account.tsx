import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Dropdown } from 'react-native-element-dropdown'
import { api } from '@/lib/api'
import { useAuthSession } from '@/providers/AuthProvider'
import PROVINCES from '@/data/provinces.json'

function errMsg(e: any, fallback: string) {
  const d = e?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}

export default function Account() {
  const { user, refresh } = useAuthSession()
  const [name, setName] = useState(user?.name ?? '')
  const [division, setDivision] = useState(user?.division ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [province, setProvince] = useState<string | null>(null)
  const [pending, setPending] = useState<{ status: string; province: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // current/last region-change request, so a pending one disables resubmitting
  useEffect(() => {
    api.get('/officers/me/region-change').then((r) => {
      if (r.data?.status === 'pending') setPending(r.data)
    }).catch(() => {})
  }, [])

  const saveProfile = async () => {
    if (!name.trim()) return Alert.alert('กรุณากรอกชื่อ')
    setBusy('name')
    try {
      await api.patch('/officers/me/profile', { name: name.trim(), division: division.trim() })
      await refresh()
      Alert.alert('บันทึกข้อมูลแล้ว')
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', errMsg(e, 'ไม่สามารถบันทึกข้อมูลได้'))
    } finally {
      setBusy(null)
    }
  }

  const saveUsername = async () => {
    if (!username.trim()) return Alert.alert('กรุณากรอกชื่อผู้ใช้')
    setBusy('username')
    try {
      // fastapi-users keys the identity field as `email` internally; the value is the username
      await api.patch('/users/me', { email: username.trim() })
      await refresh()
      Alert.alert('บันทึกชื่อผู้ใช้แล้ว')
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', errMsg(e, 'ไม่สามารถบันทึกชื่อผู้ใช้ได้ (อาจถูกใช้งานแล้ว)'))
    } finally {
      setBusy(null)
    }
  }

  const savePassword = async () => {
    if (password.length < 8) return Alert.alert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
    if (password !== confirm) return Alert.alert('รหัสผ่านไม่ตรงกัน')
    setBusy('password')
    try {
      await api.patch('/users/me', { password })
      setPassword('')
      setConfirm('')
      Alert.alert('เปลี่ยนรหัสผ่านแล้ว')
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', errMsg(e, 'ไม่สามารถเปลี่ยนรหัสผ่านได้'))
    } finally {
      setBusy(null)
    }
  }

  const submitRegion = async () => {
    if (!province) return Alert.alert('กรุณาเลือกจังหวัด')
    setBusy('region')
    try {
      const r = await api.post('/officers/me/region-change', { province_code: province })
      setPending({ status: 'pending', province: r.data.province })
      Alert.alert('ส่งคำขอแล้ว', 'คำขอย้ายพื้นที่จะถูกส่งให้ผู้ควบคุมอนุมัติ')
    } catch (e) {
      Alert.alert('ไม่สำเร็จ', errMsg(e, 'ไม่สามารถส่งคำขอได้'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Section title="ชื่อ-นามสกุล / สังกัด">
            <TextInput value={name} onChangeText={setName} style={styles.input} autoCapitalize="words" />
            <TextInput value={division} onChangeText={setDivision} style={styles.input}
              placeholder="สังกัด" autoCorrect={false} />
            <SaveButton label="บันทึกข้อมูล" onPress={saveProfile} loading={busy === 'name'} />
          </Section>

          <Section title="ชื่อผู้ใช้">
            <TextInput value={username} onChangeText={setUsername} style={styles.input}
              textContentType="username" autoCapitalize="none" autoCorrect={false} />
            <SaveButton label="บันทึกชื่อผู้ใช้" onPress={saveUsername} loading={busy === 'username'} />
          </Section>

          <Section title="เปลี่ยนรหัสผ่าน">
            <TextInput value={password} onChangeText={setPassword} style={styles.input}
              secureTextEntry placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" autoCapitalize="none" />
            <TextInput value={confirm} onChangeText={setConfirm} style={styles.input}
              secureTextEntry placeholder="ยืนยันรหัสผ่านใหม่" autoCapitalize="none" />
            <SaveButton label="เปลี่ยนรหัสผ่าน" onPress={savePassword} loading={busy === 'password'} />
          </Section>

          <Section title="ย้ายพื้นที่รับผิดชอบ">
            {pending ? (
              <Text style={styles.pending}>
                รออนุมัติย้ายไป: {pending.province}
              </Text>
            ) : (
              <>
                <Dropdown
                  data={PROVINCES}
                  labelField="name_th"
                  valueField="code"
                  placeholder="เลือกจังหวัดปลายทาง..."
                  search
                  searchPlaceholder="ค้นหาจังหวัด..."
                  value={province}
                  onChange={(item: any) => setProvince(item.code)}
                  style={styles.input}
                  selectedTextStyle={{ fontSize: 14 }}
                  placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
                  inputSearchStyle={{ fontSize: 14, borderRadius: 6 }}
                />
                <Text style={styles.hint}>คำขอจะถูกส่งให้ผู้ควบคุมพื้นที่ปลายทางอนุมัติ</Text>
                <SaveButton label="ส่งคำขอย้ายพื้นที่" onPress={submitRegion} loading={busy === 'region'} />
              </>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function SaveButton({ label, onPress, loading }: { label: string; onPress: () => void; loading: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={loading} style={[styles.button, loading && styles.buttonDisabled]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, gap: 16 },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#374151' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14 },
  hint: { fontSize: 12, color: '#9ca3af' },
  pending: { fontSize: 14, color: '#b45309', backgroundColor: '#fffbeb', padding: 12, borderRadius: 10 },
  button: { backgroundColor: '#10b981', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
