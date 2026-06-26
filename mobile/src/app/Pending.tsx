import { useState } from 'react'
import { Redirect } from 'expo-router'
import { ActivityIndicator, Pressable, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthSession } from '@/providers/AuthProvider'

export default function Pending() {
  const { user, refresh, signOut } = useAuthSession()
  const [checking, setChecking] = useState(false)

  if (!user) return <Redirect href="/Login" />
  if (user.is_verified) return <Redirect href="/" />

  const onRefresh = async () => {
    setChecking(true)
    try {
      await refresh()
    } finally {
      setChecking(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-secondary">
      {/* Centered status card — large rounded border, no brand header. */}
      <View className="flex-1 items-center justify-center p-6">
        <View className="w-full justify-center gap-4 rounded-3xl bg-foreground p-6">

          <Text className="self-center border-b-2 border-border pb-2 text-xl font-sans-normal text-card-foreground">
            {user.username}
          </Text>
          
          <Text className="self-center text-2xl font-sans-semibold text-card-foreground border-2 px-3 py-1.5 rounded-full">
            รอการอนุมัติ
          </Text>

          <Text className="text-center text-base font-head text-muted-foreground">
            บัญชีของคุณกำลังรอผู้ดูแลระบบยืนยัน
          </Text>

          <TouchableOpacity
            onPress={onRefresh}
            disabled={checking}
            className={`items-center rounded-2xl bg-primary p-3.5 ${checking ? 'opacity-60' : ''}`}
          >
            {checking ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-sans-semibold text-white">ตรวจสอบสถานะอีกครั้ง</Text>
            )}
          </TouchableOpacity>

          <Pressable onPress={signOut} className="items-center">
            <Text className="text-destructive">ออกจากระบบ</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}
