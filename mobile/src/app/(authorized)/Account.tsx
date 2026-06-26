import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Dropdown } from 'react-native-element-dropdown'
import { api } from '@/lib/api'
import { useAuthSession } from '@/providers/AuthProvider'
import PROVINCES from '@/data/provinces.json'
import { colors } from '@/lib/theme'

function errMsg(e: any, fallback: string) {
  const d = e?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}

// shadow + the Dropdown container can't be className'd — keep them as style objects.
const cardShadow = {
  elevation: 2,
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}
const dropdownStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }

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

  // refresh on every focus so the section resets to the default dropdown once a
  // request is decided (approved/rejected) — a still-pending one keeps disabling resubmit
  useFocusEffect(
    useCallback(() => {
      api.get('/officers/me/region-change').then((r) => {
        setPending(r.data?.status === 'pending' ? r.data : null)
      }).catch(() => {})
    }, []),
  )

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
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Section title="ชื่อ-นามสกุล / สังกัด">
            <TextInput value={name} onChangeText={setName} className={inputCls} autoCapitalize="words" />
            <TextInput value={division} onChangeText={setDivision} className={inputCls}
              placeholder="สังกัด" autoCorrect={false} />
            <SaveButton label="บันทึกข้อมูล" onPress={saveProfile} loading={busy === 'name'} />
          </Section>

          <Section title="ชื่อผู้ใช้">
            <TextInput value={username} onChangeText={setUsername} className={inputCls}
              textContentType="username" autoCapitalize="none" autoCorrect={false} />
            <SaveButton label="บันทึกชื่อผู้ใช้" onPress={saveUsername} loading={busy === 'username'} />
          </Section>

          <Section title="เปลี่ยนรหัสผ่าน">
            <TextInput value={password} onChangeText={setPassword} className={inputCls}
              secureTextEntry placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" autoCapitalize="none" />
            <TextInput value={confirm} onChangeText={setConfirm} className={inputCls}
              secureTextEntry placeholder="ยืนยันรหัสผ่านใหม่" autoCapitalize="none" />
            <SaveButton label="เปลี่ยนรหัสผ่าน" onPress={savePassword} loading={busy === 'password'} />
          </Section>

          <Section title="ย้ายพื้นที่รับผิดชอบ">
            {pending ? (
              <Text className="rounded-[10px] bg-[#fffbeb] p-3 text-sm font-head text-[#b45309]">
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
                  style={dropdownStyle}
                  selectedTextStyle={{ fontSize: 14, color: colors.cardForeground }}
                  placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
                  inputSearchStyle={{ fontSize: 14, borderRadius: 6 }}
                />
                <Text className="text-xs font-head text-gray-400">คำขอจะถูกส่งให้ผู้ควบคุมพื้นที่ปลายทางอนุมัติ</Text>
                <SaveButton label="ส่งคำขอย้ายพื้นที่" onPress={submitRegion} loading={busy === 'region'} />
              </>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// shared input styling (also mirrored by dropdownStyle for the province picker)
const inputCls = 'rounded-[10px] border border-border p-3 text-sm font-sans text-card-foreground'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2.5 rounded-2xl bg-foreground p-4" style={cardShadow}>
      <Text className="text-[15px] font-sans-bold text-accent">{title}</Text>
      {children}
    </View>
  )
}

function SaveButton({ label, onPress, loading }: { label: string; onPress: () => void; loading: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className={`items-center rounded-xl py-3 ${loading ? 'bg-gray-400' : 'bg-primary'}`}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-[15px] font-sans-semibold text-white">{label}</Text>}
    </Pressable>
  )
}
