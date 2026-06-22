import Toast from './toast'
import { useToastStore } from '../lib/toastStore'

// Single mount point for the global toast queue. Owns positioning + stacking so
// individual <Toast> cards stay purely presentational.
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          duration={t.duration}
          onClose={() => dismiss(t.id)}
        />
      ))}
    </div>
  )
}
