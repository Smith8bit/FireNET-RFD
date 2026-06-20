import { useState } from 'react'
import AuditTrail from '../components/management/auditTrail'
import HistoryTab from '../components/management/HistoryTab'
import PendingTab from '../components/management/PendingTab'
import OfficersTab from '../components/management/OfficersTab'
import DispatchersTab from '../components/management/DispatchersTab'
import { useAuthStore, can } from '../functions/useAuthStore'

export default function ManagementPage() {
  const user = useAuthStore((s) => s.user)
  const [selectedTab, setSelectedTab] = useState('Pending')
  const [pendingCount, setPendingCount] = useState(null)

  // each tab shows only if the user holds the matching permission (Audit stays superuser-only)
  const tabs = [
    can(user, 'officers.view') && 'Pending',
    can(user, 'officers.view') && 'Officers',
    can(user, 'dispatchers.view') && 'Dispatchers',
    can(user, 'fires.view') && 'History',
    user?.is_superuser && 'Audit',
  ].filter(Boolean)
  const activeTab = tabs.includes(selectedTab) ? selectedTab : tabs[0]

  const TAB_LABELS = {
    Pending: `รอยืนยัน${pendingCount != null ? ` (${pendingCount})` : ''}`,
    Officers: 'เจ้าหน้าที่',
    Dispatchers: 'ผู้ควบคุม',
    History: 'ประวัติการดับไฟ',
    Audit: 'บันทึกเหตุการณ์',
  }

  return (
    <div className="py-2 h-screen flex flex-col gap-2 w-1/2 self-center overflow-y-hidden">
      <div className='bg-white border-0 rounded-2xl p-6'>
        <h2 className="text-lg font-semibold text-forest-700 mb-3 font-title">การจัดการเจ้าหน้าที่ภาคสนาม</h2>
        <div className="flex gap-2 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-forest-500 text-forest-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[tab] ?? tab}
            </button>
          ))}
        </div>
      </div>
      <div className='flex-1 bg-white border-0 rounded-2xl p-6 mb-1'>
        {activeTab === 'Pending' && <PendingTab onCount={setPendingCount} />}
        {activeTab === 'Officers' && <OfficersTab />}
        {activeTab === 'Dispatchers' && <DispatchersTab />}
        {activeTab === 'History' && <HistoryTab />}
        {activeTab === 'Audit' && <AuditTrail />}
      </div>
    </div>
  )
}
