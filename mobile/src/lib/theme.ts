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

// Font families loaded in src/app/_layout.tsx (Kanit = web --font-sans body).
export const fonts = {
  regular: 'Kanit_400Regular',
  medium: 'Kanit_500Medium',
  semibold: 'Kanit_600SemiBold',
  bold: 'Kanit_700Bold',
} as const
