
export default function DashboardPage() {

  return (
    <div className='flex justify-center items-center h-full'>
      <div className="flex flex-col justify-center items-center text-center gap-2 border-3 rounded-2xl p-6 border-gray-400">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.25} stroke="currentColor" className="size-12 text-gray-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
        <p className='font-medium text-gray-500 text-2xl font-title'>อยู่ระหว่างการพัฒนา</p>
      </div>
    </div>
  )
}
