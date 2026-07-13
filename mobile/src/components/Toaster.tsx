import { useToastStore } from '@/lib/toastStore'
import { Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Toast from './Toast'

/**
 * Global toast host: renders every toast currently in `useToastStore` as a
 * stack pinned below the status bar.
 *
 * Mount once near the app root — toasts are triggered elsewhere by pushing
 * onto the shared store, not via props, so any part of the app can surface
 * a toast without prop drilling.
 *
 * Uses a transparent, always-`visible` RN `Modal` (rather than a plain
 * absolutely-positioned `View`) so toasts render above other native modals
 * and are not clipped by their bounds.
 *
 * @returns null while there are no toasts, so it never blocks touches (via the modal) when nothing is showing
 */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const insets = useSafeAreaInsets()

  if (toasts.length === 0) return null

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={() => {}}>
      {/* box-none lets touches pass through the empty space around the toasts to the screen underneath. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, gap: 8 }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} duration={t.duration} onClose={() => dismiss(t.id)} />
        ))}
      </View>
    </Modal>
  )
}
