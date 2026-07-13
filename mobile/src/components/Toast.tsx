import type { ToastType } from '@/lib/toastStore'
import { Ionicons } from '@expo/vector-icons'
import { useEffect } from 'react'
import { Pressable, Text } from 'react-native'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'

// Visual treatment (colors + icon) per toast severity; keyed by ToastType so it stays exhaustive as variants are added.
const VARIANTS: Record<ToastType, { box: string; text: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  success: { box: 'bg-green-50 border-green-200', text: 'text-green-800', icon: 'checkmark-circle', iconColor: '#15803d' },
  error: { box: 'bg-red-50 border-red-200', text: 'text-red-800', icon: 'alert-circle', iconColor: '#b91c1c' },
  info: { box: 'bg-blue-50 border-blue-200', text: 'text-blue-800', icon: 'information-circle', iconColor: '#1d4ed8' },
}

/**
 * Single dismissible toast notification: auto-closes after `duration` and
 * can also be dismissed early by tapping it.
 *
 * @param message - text to display
 * @param type - severity variant controlling color/icon; defaults to `'success'`
 * @param onClose - called once, either when the timer elapses or the toast is tapped; caller (Toaster) is responsible for removing it from the store
 * @param duration - ms before auto-dismiss; defaults to 3000
 */
export default function Toast({
  message,
  type = 'success',
  onClose,
  duration = 3000,
}: {
  message: string
  type?: ToastType
  onClose: () => void
  duration?: number
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    // Guards against a stale timer firing onClose after the toast has already been dismissed/unmounted.
    return () => clearTimeout(timer)
  }, [duration, onClose])

  const v = VARIANTS[type]
  return (
    <Animated.View entering={FadeInDown} exiting={FadeOutUp} className="w-full">
      <Pressable
        onPress={onClose}
        accessibilityRole={type === 'error' ? 'alert' : 'text'}
        className={`flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${v.box}`}
        style={{ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
      >
        <Ionicons name={v.icon} size={20} color={v.iconColor} />
        <Text className={`flex-1 text-sm font-sans-medium ${v.text}`}>{message}</Text>
      </Pressable>
    </Animated.View>
  )
}
