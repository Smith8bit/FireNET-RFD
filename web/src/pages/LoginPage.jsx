export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-50 to-forest-100 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-forest-500 rounded-full mb-4 text-3xl">
            <img className="w-20 h-20" src="https://www.forest.go.th/wp-content/uploads/2023/02/color-png.png"/>
          </div>
          <h1 className="text-2xl font-bold text-forest-700">ระบบจัดการไฟป่า</h1>
        </div>
        <form className="space-y-4">
          <div>
            <label for="login-identifier" className="text-left block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input autoComplete="username" required placeholder="Username" type="text" name="login-identifier" id="login-identifier" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-forest-500 outline-none"/>
          </div>
          <div>
            <label for="login-password" className="text-left block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input autoComplete="current-password" required placeholder="••••••••" type="password" name="password" id="login-password" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-forest-500 outline-none"/>
          </div>
          <button type="submit" className="w-full bg-forest-500 hover:bg-forest-600 text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 min-h-[44px]">
            เข้าสู่ระบบ
          </button>
        </form>
      </div>
    </div>
  )
}
