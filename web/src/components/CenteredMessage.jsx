/**
 * CenteredMessage
 * Generic placeholder/empty-state block that centers arbitrary content
 * both vertically and horizontally within its parent's full height.
 * Used wherever a list/panel needs a "no data" or status message instead
 * of its normal content, without each caller re-implementing the centering layout.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children - message content to display (text or nodes)
 * @returns {JSX.Element} a full-height flex container with muted, centered text
 *
 * Assumes the parent element defines the height (`h-full`) to center against.
 */
export default function CenteredMessage({ children }) {
  return (
    <div className="h-full flex justify-center items-center">
      <p className="text-gray-400">{children}</p>
    </div>
  )
}
