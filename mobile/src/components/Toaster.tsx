import { useToastStore } from '@/lib/toastStore'
import { Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Toast from './Toast'

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const insets = useSafeAreaInsets()

  if (toasts.length === 0) return null

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={() => {}}>
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
