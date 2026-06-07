import { Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthSession } from '@/providers/AuthProvider'

export default function Home() {
  const { user, signOut } = useAuthSession()
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '600' }}>ระบบจัดการไฟป่า</Text>
        <Text>เข้าสู่ระบบในฐานะเจ้าหน้าที่ภาคสนาม</Text>
        <Text style={{ color: '#666' }}>{user?.email}</Text>
        <Pressable
          onPress={signOut}
          style={{ backgroundColor: '#b91c1c', padding: 14, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>ออกจากระบบ</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}