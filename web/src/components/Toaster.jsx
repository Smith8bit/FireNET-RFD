import Toast from './toast'
import { useToastStore } from '../lib/toastStore'

/**
 * Toaster
 * App-wide toast notification host. Subscribes to the global `useToastStore`
 * and renders every active toast fixed to the top-center of the viewport,
 * so any part of the app can trigger a toast via the store without needing
 * to mount its own UI for it.
 *
 * @returns {JSX.Element|null} stacked toast list, or null when there is nothing to show
 *
 * Depends on `useToastStore` for both the toast queue (`toasts`) and the
 * `dismiss` action; each `Toast` is responsible for its own auto-close timer.
 * `pointer-events-none` on the wrapper (with `pointer-events-auto` on each
 * toast) keeps the empty space around toasts from blocking clicks underneath.
 */
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
