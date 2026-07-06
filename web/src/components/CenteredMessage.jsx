export default function CenteredMessage({ children }) {
  return (
    <div className="h-full flex justify-center items-center">
      <p className="text-gray-400">{children}</p>
    </div>
  )
}
