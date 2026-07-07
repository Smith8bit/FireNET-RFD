import { useEffect } from 'react'

/**
 * Toast
 * Single self-dismissing notification banner. Owns its own auto-close timer
 * so the parent (`Toaster`) only needs to manage the list of active toasts,
 * not their lifetimes.
 *
 * @param {object} props
 * @param {string} props.message - text to display; an empty/falsy message renders nothing
 * @param {'success'|'error'|'info'} [props.type='success'] - visual style and ARIA role/live-region urgency
 * @param {() => void} props.onClose - called when the toast should be removed (timeout or manual close)
 * @param {number} [props.duration=3000] - milliseconds before auto-dismiss
 * @returns {JSX.Element|null} the toast banner, or null while there is no message
 *
 * Edge cases: the effect bails out early (no timer) when `message` is falsy,
 * and always clears the previous timeout on re-render/unmount to avoid stale
 * `onClose` calls firing after the toast has already changed or closed.
 * `role`/`aria-live` switch to assertive for errors so screen readers
 * interrupt for them, but stay polite for success/info.
 */
export default function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [message, duration, onClose])

  if (!message) return null

  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  }

  const role = type === 'error' ? 'alert' : 'status'
  const ariaLive = type === 'error' ? 'assertive' : 'polite'

  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className={` animate-slide-in-top border rounded-lg shadow-lg px-4 py-3 max-w-sm pointer-events-auto ${styles[type]}`}
    >
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm flex-1">{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดการแจ้งเตือน"
          className="text-gray-400 hover:text-gray-600 text-lg leading-none inline-flex items-center justify-center min-w-6 min-h-6"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  )
}
