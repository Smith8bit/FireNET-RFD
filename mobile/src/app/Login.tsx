import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useAuthSession } from '@/providers/AuthProvider'

const resize = LinearTransition.duration(300)

export default function Login() {
  const { signIn } = useAuthSession()
  const router = useRouter()
  const [mode, setMode] = useState<'choice' | 'login'>('choice')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordHidden, setPasswordHidden] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const keyboardOffset = useSharedValue(0)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardOffset.value = withTiming(e.endCoordinates.height, { duration: e.duration || 250 })
    })
    const hide = Keyboard.addListener(hideEvent, (e) => {
      keyboardOffset.value = withTiming(0, { duration: e.duration || 250 })
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [keyboardOffset])

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardOffset.value }],
  }))

  const onSubmit = async () => {
    if (submitting) return
    setError(null)
    if (!username || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }
    setSubmitting(true)
    try {
      await signIn(username.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className="flex-1 bg-secondary">
      <SafeAreaView edges={['top']} className="flex-1">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-5xl font-sans-semibold text-white">FireNET</Text>
          <Text className=" text-xl font-sans-semibold text-white">ระบบจัดการไฟป่า</Text>
          <Text className="mt-1 text-lg font-head-semibold text-accent">สำหรับเจ้าหน้าที่ภาคสนาม</Text>
        </View>
      </SafeAreaView>

      <Animated.View
        layout={resize}
        className="absolute inset-x-4 bottom-0 pb-8 rounded-t-3xl bg-foreground"
        style={[
          {
            shadowColor: '`#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 16,
            elevation: 12,
          },
          sheetStyle,
        ]}
      >
        <SafeAreaView edges={['bottom']} className="overflow-hidden rounded-3xl">
          {mode === 'choice' ? (
            <View className="gap-6 p-6">
              <TouchableOpacity
                onPress={() => setMode('login')}
                className="items-center rounded-full bg-primary p-4"
              >
                <Text className="text-lg font-sans-semibold text-white">เข้าสู่ระบบ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/Register')}
                className="items-center rounded-full border border-primary p-4"
              >
                <Text className="text-lg font-sans-semibold text-primary">สมัครสมาชิก</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="gap-4 p-6">
              <Pressable
                onPress={() => {
                  setMode('choice')
                  setError(null)
                }}
                className="self-start"
              >
                <Text className="text-sm text-primary border border-primary rounded-full px-3 py-0.5">‹ กลับ</Text>
              </Pressable>

              <Text className="self-center text-2xl font-sans-semibold text-card-foreground">
                เข้าสู่ระบบ
              </Text>

              <View className="gap-0.5">
                <Text className="text-card-foreground text-md font-head-medium">ชื่อผู้ใช้</Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder="ชื่อผู้ใช้"
                  textContentType="username"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="rounded-lg border border-input p-3"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-card-foreground text-md font-head-medium">รหัสผ่าน</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={passwordHidden}
                  textContentType="password"
                  placeholder="••••••••"
                  autoCapitalize="none"
                  className="rounded-lg border border-input p-3"
                />
                <Pressable
                  onPress={() => setPasswordHidden((v) => !v)}
                  className="self-start"
                >
                  <Text className="text-primary">
                    {passwordHidden ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน'}
                  </Text>
                </Pressable>
              </View>

              {error ? <Text className="text-destructive self-center">{error}</Text> : null}

              <TouchableOpacity
                onPress={onSubmit}
                disabled={submitting}
                className={`items-center rounded-2xl bg-primary p-3.5 ${submitting ? 'opacity-60' : ''}`}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="font-sans-semibold text-white">เข้าสู่ระบบ</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Animated.View>
    </View>
  )
}
