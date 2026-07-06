export default function PaginationBar({ page, pageSize, total, onPage, className = '' }) {
  const lastPage = Math.max(Math.ceil(total / pageSize) - 1, 0)
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)
  const btnCls = 'px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50'

  return (
    <div className={`flex items-center justify-between pt-3 text-sm text-gray-600${className ? ` ${className}` : ''}`}>
      <div className="flex gap-1">
        <button type="button" onClick={() => onPage(0)} disabled={page === 0} className={btnCls}>
          หน้าแรก
        </button>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} className={btnCls}>
          ก่อนหน้า
        </button>
      </div>
      <span>
        {start}–{end} จาก {total}
      </span>
      <div className="flex gap-1">
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= lastPage} className={btnCls}>
          ถัดไป
        </button>
        <button type="button" onClick={() => onPage(lastPage)} disabled={page >= lastPage} className={btnCls}>
          หน้าสุดท้าย
        </button>
      </div>
    </div>
  )
}
