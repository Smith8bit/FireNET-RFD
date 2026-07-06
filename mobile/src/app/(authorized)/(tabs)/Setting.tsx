import { downloadHomePack, homePackSize } from '@/lib/offlineMap'
import { colors } from '@/lib/theme'
import { toast } from '@/lib/toastStore'
import { useAuthSession, type Home } from '@/providers/AuthProvider'
import { Ionicons } from '@expo/vector-icons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

type Row = { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }

const ROWS: Row[] = [
  { icon: 'person-circle-outline', label: 'บัญชีของฉัน', route: '/(authorized)/Account' },
  { icon: 'swap-horizontal-outline', label: 'ย้ายพื้นที่รับผิดชอบ', route: '/(authorized)/RegionChange' },
  { icon: 'time-outline', label: 'ประวัติการดับไฟ', route: '/(authorized)/History' },
]

// Soft shadow via boxShadow (New Arch), NOT Android `elevation`: elevation
// re-rasterizes each frame and shimmers while the tab transition translates the
// screen; boxShadow composites with the view and moves with it cleanly.
const cardShadow = { boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.10)' } as const

const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

// Pre-download the officer's home region so the map works with no signal.
function OfflineMapButton({ home }: { home: Home }) {
  const [percent, setPercent] = useState<number | null>(null)
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => { homePackSize().then(setSize).catch(() => {}) }, [])

  const busy = percent !== null
  const download = async () => {
    if (busy) return
    setPercent(0)
    try {
      await downloadHomePack(home, (p) => setPercent(Math.round(p)))
      setSize(await homePackSize())
      toast.success('ดาวน์โหลดแผนที่ออฟไลน์เรียบร้อยแล้ว')
    } catch {
      toast.error('ดาวน์โหลดแผนที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPercent(null)
    }
  }

  return (
    <Pressable
      onPress={download}
      disabled={busy}
      className="flex-row items-center gap-3 py-5"
    >
      <Ionicons name="cloud-download-outline" size={24} color={colors.gray500} />
      <Text className="text-md font-sans-medium text-card-foreground">
        {busy
          ? `กำลังดาวน์โหลด... ${percent}%`
          : size != null
            ? `ดาวน์โหลดแผนที่ออฟไลน์ (${fmtMB(size)})`
            : 'ดาวน์โหลดแผนที่ออฟไลน์'}
      </Text>
      {busy ? (
        <ActivityIndicator style={{ marginLeft: 'auto' }} color={colors.primary} />
      ) : size != null ? (
        <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={{ marginLeft: 'auto' }} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.gray400} style={{ marginLeft: 'auto' }} />
      )}
    </Pressable>
  )
}

function LogoutButton({ onConfirm }: { onConfirm: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotion()
  const [fullW, setFullW] = useState(0)
  const progress = useSharedValue(0)
  useFocusEffect(useCallback(() => () => setExpanded(false), []))

  useEffect(() => {
    const to = expanded ? 1 : 0
    progress.value = reduced ? to : withTiming(to, { duration: 240, easing: Easing.out(Easing.quad) })
  }, [expanded, reduced, progress])

  // Drive width from a 52px circle out to full width, right edge pinned by the
  // parent's items-end. It reads as the circle expanding in place, not a pill
  // flying in from the right. overflow-hidden clips the label until it fits.
  const style = useAnimatedStyle(() => ({
    width: fullW > 0 ? 52 + (fullW - 52) * progress.value : 52,
  }))

  return (
    <View className="mt-1 items-end" onLayout={(e) => setFullW(e.nativeEvent.layout.width)}>
      <Animated.View style={style} className="h-[52px] overflow-hidden rounded-full bg-destructive">
        <Pressable
          onPress={expanded ? onConfirm : () => setExpanded(true)}
          className="flex-1 flex-row items-center justify-center gap-2"
        >
          <Ionicons name="log-out-outline" size={22} color="#fff" />
          {expanded && (
            <Animated.Text
              entering={reduced ? undefined : FadeIn.duration(180)}
              exiting={reduced ? undefined : FadeOut.duration(120)}
              numberOfLines={1}
              className="text-base font-sans-semibold text-white"
            >
              ออกจากระบบ
            </Animated.Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  )
}

export default function Setting() {
  const { user, signOut } = useAuthSession()
  return (
    <SafeAreaView className="flex-1 bg-foreground">
      <View style={{ flex: 1, padding: 12, gap: 12 }}>
        <View className="flex-row items-center p-3 gap-3 rounded-2xl bg-foreground border-border" style={cardShadow}>
          <Ionicons name="person-circle" size={64} color={colors.primary} />
          <View className="shrink">
            <Text className="text-xl font-sans-bold text-accent">{user?.name ?? 'เจ้าหน้าที่ภาคสนาม'}</Text>
            {user?.division ? <Text className="text-md font-head-medium text-gray-500">สังกัด: {user.division}</Text> : null}
          </View>
        </View>

        <View className="rounded-2xl bg-foreground px-4 flex-1">
          {ROWS.map((r) => (
            <Pressable
              key={r.route}
              onPress={() => router.push(r.route as never)}
              className="flex-row items-center gap-3 py-5 border-b border-border"
            >
              <Ionicons name={r.icon} size={24} color={colors.gray500} />
              <Text className="text-md font-sans-medium text-card-foreground">{r.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.gray400} style={{ marginLeft: 'auto' }} />
            </Pressable>
          ))}
          {user && <OfflineMapButton home={user.home} />}
          <LogoutButton onConfirm={signOut} />
        </View>


      </View>
    </SafeAreaView>
  )
}
