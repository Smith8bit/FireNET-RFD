import { useState } from 'react'
import { Redirect } from 'expo-router'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
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
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '600' }}>รอการอนุมัติ</Text>
        <Text>บัญชีเจ้าหน้าที่ภาคสนามของคุณกำลังรอผู้ดูแลระบบยืนยัน</Text>
        <Text style={{ color: '#666' }}>{user.username}</Text>

        <Pressable
          onPress={onRefresh}
          disabled={checking}
          style={{ backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' }}
        >
          {checking ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '600' }}>ตรวจสอบสถานะอีกครั้ง</Text>}
        </Pressable>

        <Pressable onPress={signOut} style={{ padding: 12, alignItems: 'center' }}>
          <Text style={{ color: '#b91c1c' }}>ออกจากระบบ</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}