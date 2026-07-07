//
// Imperative style tokens for the few spots a Tailwind className can't reach:
// Ionicons / Switch / ActivityIndicator color props, the expo-router <Tabs>
// screenOptions, and StyleSheet shadow objects. Everything else is styled with
// NativeWind classes whose tokens live in tailwind.config.js.
//
// Mirrored from the web theme (web/src/index.css). Keep in sync with
// tailwind.config.js when the web theme changes.
//
export const colors = {
  foreground: '#FFFFFF', // cards / sheets
  cardForeground: '#1A1A1A', // primary text on white
  accent: '#292929',
  primary: '#FF4000', // flame
  border: '#D7D5CC', // hsl(50 12% 82%)
  gray500: '#6B7280',
  gray400: '#9CA3AF',
  gray300: '#D1D5DB',
  success: '#248F4B', // hsl(142 60% 35%)
  destructive: '#C52020', // hsl(0 72% 45%)
} as const

// Shadow style objects for the few spots a Tailwind className can't reach faithfully
// on both platforms. `float` is used by the floating map/refresh buttons; `card` by
// elevated cards. Setting.tsx keeps its own boxShadow variant on purpose (elevation
// shimmers while the tab transition translates the screen).
export const shadows = {
  float: { elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  card: { elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
} as const

// Font families loaded in src/app/_layout.tsx (Kanit = web --font-sans body).
export const fonts = {
  regular: 'Kanit_400Regular',
  medium: 'Kanit_500Medium',
  semibold: 'Kanit_600SemiBold',
  bold: 'Kanit_700Bold',
} as const
