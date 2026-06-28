import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Dropdown } from 'react-native-element-dropdown'
import { Province, useAuthSession } from '@/providers/AuthProvider'
import { api } from '@/lib/api'
import PROVINCES from '@/data/provinces.json'

// Smoothly animate the card's height as it grows/shrinks between steps.
const resize = LinearTransition.duration(250)

const STEPS = ['ชื่อและบัญชีผู้ใช้', 'สังกัดและพื้นที่', 'รหัสผ่าน', 'ตรวจสอบข้อมูล'] as const

// Plain style objects for the Dropdown (it doesn't accept className). It sits
// inside a FieldBox that supplies the filled background, so it stays transparent.
const dropdownStyle = { borderWidth: 0, backgroundColor: 'transparent', paddingVertical: 2 } as const

// Fixed row height so the dropdown's auto-scroll-to-selected (scrollToIndex) is
// reliable for provinces far down the list — it needs a matching getItemLayout.
const PROVINCE_ITEM_HEIGHT = 48

export default function Register() {
  const { signUp, signIn } = useAuthSession()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [division, setDivision] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [province, setProvince] = useState<Province | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Returns true when the fields belonging to the current step are valid;
  // otherwise sets the error message and returns false.
  const validateStep = () => {
    const fail = (msg: string) => {
      setError(msg)
      return false
    }
    setError(null)
    if (step === 0) {
      if (!name.trim()) return fail('กรุณากรอกชื่อ-นามสกุล')
      if (!username.trim()) return fail('กรุณากรอกชื่อผู้ใช้')
    }
    if (step === 1) {
      if (!province) return fail('กรุณาเลือกจังหวัด')
    }
    if (step === 2) {
      if (!password) return fail('กรุณากรอกรหัสผ่าน')
      if (password.length < 8) return fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      if (!confirm) return fail('กรุณายืนยันรหัสผ่าน')
      if (password !== confirm) return fail('รหัสผ่านไม่ตรงกัน')
    }
    return true
  }

  const [checking, setChecking] = useState(false)

  const next = async () => {
    if (!validateStep()) return
    // On the username step, make sure it isn't already taken before moving on.
    if (step === 0) {
      setChecking(true)
      try {
        const { data } = await api.get('/officers/username-available', {
          params: { username: username.trim() },
        })
        if (!data.available) {
          setError('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว')
          return
        }
      } catch {
        setError('ตรวจสอบชื่อผู้ใช้ไม่สำเร็จ กรุณาลองใหม่')
        return
      } finally {
        setChecking(false)
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => {
    setError(null)
    if (step === 0) router.back() // first step → back to Login
    else setStep((s) => s - 1)
  }

  const onSubmit = async () => {
    if (submitting) return
    if (!validateStep()) return
    setSubmitting(true)
    try {
      await signUp(username.trim(), password, province!.code, name.trim(), division.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สมัครสมาชิกไม่สำเร็จ')
      setSubmitting(false)
      return
    }
    try {
      await signIn(username.trim(), password) // -> gate routes to /Pending until admin verifies
    } catch {
      // registered fine but auto-login failed (e.g. network blip)
      setError('สมัครสมาชิกสำเร็จแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่สำเร็จ กรุณาเข้าสู่ระบบด้วยตนเอง')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-foreground">
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 120, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="mb-4 self-center text-2xl font-sans-semibold text-card-foreground">สมัครสมาชิก</Text>
        </View>

        {/* Step indicator — one bar per step, animating its fill up to the current step. */}
        <View className="flex-row gap-0">
          {STEPS.map((label, i) => (
            <ProgressSegment key={label} active={i <= step} />
          ))}
        </View>

        <Animated.View layout={resize} className="gap-4">
          {/* Title of the current step. */}
          <Text className="text-xl font-sans-semibold text-card-foreground">{STEPS[step]}</Text>

          {step === 0 && (
            <>
              <LabeledInput
                label="ชื่อ - นามสกุล"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
              />

              <LabeledInput
                label="ชื่อผู้ใช้"
                value={username}
                onChangeText={setUsername}
                textContentType="username"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          {step === 1 && (
            <>
              <LabeledInput
                label="สังกัด"
                value={division}
                onChangeText={setDivision}
                autoCorrect={false}
              />

              <View style={{ zIndex: 999 }}>
                <FieldBox label="จังหวัด">
                  <Dropdown
                    data={PROVINCES}
                    labelField="name_th"
                    valueField="id"
                    placeholder="เลือกจังหวัด..."
                    search
                    searchPlaceholder="ค้นหาจังหวัด..."
                    value={province?.id ?? null}
                    onChange={(item) => setProvince(item)}
                    style={dropdownStyle}
                    selectedTextStyle={{ fontSize: 16, color: '#1A1A1A' }}
                    placeholderStyle={{ fontSize: 16, color: '#9ca3af' }}
                    inputSearchStyle={{ fontSize: 16, borderRadius: 6 }}
                    autoScroll
                    maxHeight={320}
                    activeColor="#ffebe5"
                    itemContainerStyle={{ height: PROVINCE_ITEM_HEIGHT, justifyContent: 'center' }}
                    renderItem={(item) => (
                      <Text style={{ paddingHorizontal: 16, fontSize: 16, color: '#1A1A1A' }}>
                        {item.name_th}
                      </Text>
                    )}
                    flatListProps={{
                      getItemLayout: (_, index) => ({
                        length: PROVINCE_ITEM_HEIGHT,
                        offset: PROVINCE_ITEM_HEIGHT * index,
                        index,
                      }),
                    }}
                  />
                </FieldBox>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <LabeledInput
                label="รหัสผ่าน"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={passwordHidden}
                textContentType="newPassword"
                autoCapitalize="none"
              />

              <LabeledInput
                label="ยืนยันรหัสผ่าน"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={passwordHidden}
                autoCapitalize="none"
              />

              <Pressable onPress={() => setPasswordHidden((v) => !v)} className="self-start">
                <Text className="text-primary">{passwordHidden ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน'}</Text>
              </Pressable>
            </>
          )}

          {step === 3 && (
            /* Final review of everything entered in the previous steps. */
            <View className=" gap-4 rounded-lg border-0 bg-background/40 p-4">
              <Summary label="ชื่อ-นามสกุล" value={name.trim()}/>
              <Summary label="ชื่อผู้ใช้" value={username.trim()} />
              <Summary label="สังกัด" value={division.trim() || '—'} />
              <Summary label="จังหวัด" value={province?.name_th ?? '—'} />
            </View>
          )}

          {error ? <Text className="text-destructive">{error}</Text> : null}
        </Animated.View>
      </ScrollView>

      {/* Floating circular nav — back (steps back, or exits to Login from the
          first step) on the left, next/submit on the right. */}
      <View className="absolute inset-x-6 bottom-16 flex-row items-center justify-between">
        <TouchableOpacity
          onPress={back}
          disabled={submitting}
          className="h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-foreground"
        >
          <Ionicons name="arrow-back" size={24} color="#FF4000" />
        </TouchableOpacity>

        {step < STEPS.length - 1 ? (
          <TouchableOpacity
            onPress={next}
            disabled={checking}
            className={`h-16 w-16 items-center justify-center rounded-full bg-primary ${checking ? 'opacity-60' : ''}`}
          >
            {checking ? (
              <ActivityIndicator color="white" />
            ) : (
              <Ionicons name="arrow-forward" size={24} color="#ffffff" />
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onSubmit}
            disabled={submitting}
            className={`h-14 w-14 items-center justify-center rounded-full bg-primary ${submitting ? 'opacity-60' : ''}`}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Ionicons name="checkmark" size={26} color="#ffffff" />
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

// One segment of the step indicator. Its primary-colored fill animates its
// width in/out as the step crosses this segment, instead of toggling instantly.
function ProgressSegment({ active }: { active: boolean }) {
  const fill = useSharedValue(active ? 1 : 0)
  useEffect(() => {
    fill.value = withTiming(active ? 1 : 0, { duration: 300 })
  }, [active, fill])
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }))
  return (
    <View className="h-1.5 flex-1 overflow-hidden bg-background/50">
      <Animated.View style={fillStyle} className="h-full bg-primary" />
    </View>
  )
}

// Filled, rounded field with a small label pinned to its top-left corner.
function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl bg-background/40 px-4 py-3">
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
        className="p-0 text-xl text-card-foreground"
        // Fixed height + no Android font padding so the box never reflows while typing.
        style={{ height: 34, includeFontPadding: false, textAlignVertical: 'center' }}
      />
    </FieldBox>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-base font-head text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-base font-head-medium text-card-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}
