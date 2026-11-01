import { colors, fonts } from '@/lib/theme'
import { useFireStore } from '@/stores/fireStore'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { Text, View } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

const TAB_BAR_HEIGHT = 80
// Height of the Test-mode strip; the tab bar grows by this much so the strip sits
// inside it and never covers screen content (e.g. the map's floating buttons).
const TEST_STRIP_HEIGHT = 24
const TEST_AMBER = '#FBBF24'

/**
 * Bottom tab navigator for the three main authorized screens (map, my fire,
 * settings). Purely declarative route config — no data fetching here.
 *
 * While an admin has Test mode on, an amber strip on top of the tab bar marks
 * every tab: all fires shown are drill copies, kept apart from real records.
 *
 * @returns the configured `Tabs` navigator; screen order below determines tab order
 */
export default function TabsLayout() {
  const reducedMotion = useReducedMotion()
  const testMode = useFireStore((s) => s.testMode)
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          animation: reducedMotion ? 'none' : 'fade',
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.gray400,
          tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
          tabBarStyle: {
            backgroundColor: colors.foreground,
            borderTopColor: testMode ? TEST_AMBER : colors.border,
            height: TAB_BAR_HEIGHT + (testMode ? TEST_STRIP_HEIGHT : 0),
            paddingTop: testMode ? TEST_STRIP_HEIGHT : 0,
          },
          tabBarItemStyle: { paddingBottom: 8 },
        }}
      >
        <Tabs.Screen
          name="MapView"
          options={{
            title: 'แผนที่',
            tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="Firespot"
          options={{
            title: 'ไฟของคุณ',
            tabBarIcon: ({ color, size }) => <Ionicons name="flame-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="Setting"
          options={{
            title: 'การตั้งค่า',
            tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
      {testMode && (
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: TAB_BAR_HEIGHT,
            height: TEST_STRIP_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: TEST_AMBER,
          }}
        >
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: '#451A03' }}>
            โหมดทดสอบ — ข้อมูลแยกจากระบบจริง
          </Text>
        </View>
      )}
    </View>
  )
}
