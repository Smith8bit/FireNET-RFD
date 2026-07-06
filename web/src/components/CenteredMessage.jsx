// A muted placeholder message centered in its container — used for the
// loading / empty / no-match states of the console's list panels.
export default function CenteredMessage({ children }) {
  return (
    <div className="h-full flex justify-center items-center">
      <p className="text-gray-400">{children}</p>
    </div>
  )
}
