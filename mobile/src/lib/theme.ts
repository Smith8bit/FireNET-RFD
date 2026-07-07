export const colors = {
  foreground: '#FFFFFF',
  cardForeground: '#1A1A1A',
  accent: '#292929',
  primary: '#FF4000',
  border: '#D7D5CC',
  gray500: '#6B7280',
  gray400: '#9CA3AF',
  gray300: '#D1D5DB',
  success: '#248F4B',
  destructive: '#C52020',
} as const

export const shadows = {
  float: { elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  card: { elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
} as const

export const fonts = {
  regular: 'Kanit_400Regular',
  medium: 'Kanit_500Medium',
  semibold: 'Kanit_600SemiBold',
  bold: 'Kanit_700Bold',
} as const
