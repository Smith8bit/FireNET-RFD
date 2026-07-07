import { colors, fonts } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useReducedMotion } from 'react-native-reanimated'

/**
 * Bottom tab navigator for the three main authorized screens (map, my fire,
 * settings). Purely declarative route config — no data fetching here.
 *
 * @returns the configured `Tabs` navigator; screen order below determines tab order
 */
export default function TabsLayout() {
  const reducedMotion = useReducedMotion()
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? 'none' : 'fade',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray400,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.foreground, borderTopColor: colors.border, height: 80 },
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
  )
}
