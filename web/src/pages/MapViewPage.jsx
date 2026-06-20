import { useMemo, useState, useEffect, useRef } from 'react'
import { List } from 'react-window'
import { ArrowsPointingOutIcon, UserGroupIcon } from '@heroicons/react/20/solid'
import { useMapSelection, useSocketStore } from '../functions/stateStore'
import { useAuthStore, can } from '../functions/useAuthStore'
import { useFireData } from '../functions/useFireData'
import Map from '../components/map/map'
import Card from '../components/map/card'
import ExpandedCard from '../components/map/expandedCard'

import satelliteStyle from '../components/map/layers/satellite.json'
import baseStyle from '../components/map/layers/base.json'
import topoStyle from '../components/map/layers/topo.json'

const LAYERS = { 'ค่าเริ่มต้น': baseStyle, 'ดาวเทียม': satelliteStyle, 'ภูมิประเทศ': topoStyle }
// fallback view (all of Thailand) until the profile's per-region home arrives
const DEFAULT_HOME = { lat: 13.05, lng: 101.45, zoom: 5.5 }
const CARD_HEIGHT = 135 // px — must match Card's rendered height (py-3 + 3 text lines + border)

function FireRow({ index, style, fires }) {
  const f = fires[index]
  return (
    <div style={style}>
      <Card
        id={f.id}
        Title={f.name}
        Area={f.type}
        Date={f.date}
        Time={f.time}
        status={f.status}
        booked={f.booked}
      />
    </div>
  )
}

export default function MapViewPage() {
  const [selectedLayer, setSelectedLayer] = useState(LAYERS['ค่าเริ่มต้น'])
  const mapRef = useRef(null)

  // per-user opening view: center + zoom of the region this admin is assigned to
  const home = useAuthStore((s) => s.user?.home) ?? DEFAULT_HOME
  const startPoint = { lat: home.lat, lng: home.lng }

  const [officers, setOfficers] = useState([])
  const [showOfficers, setShowOfficers] = useState(true)
  const send = useSocketStore((s) => s.send)
  const ready = useSocketStore((s) => s.ready)
  const officersMsg = useSocketStore((s) => s.byType?.officers_map)
  const canViewOfficers = can(useAuthStore((s) => s.user), 'officers.view')

  useEffect(() => {
    if (!ready || !canViewOfficers) return
    send({ type: 'list_officers_MAP' })
  }, [ready, canViewOfficers])
    
  useEffect(() => {
    if (!officersMsg) return
    setOfficers(officersMsg.officers ?? [])
  }, [officersMsg])

  const fires = useFireData()

  // sort like mobile (tap the active chip again to flip direction) + filters
  const [sortBy, setSortBy] = useState('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [provinceFilter, setProvinceFilter] = useState('')
  const [satelliteFilter, setSatelliteFilter] = useState('')

  const changeSort = (key) => {
    if (sortBy === key) {
      setSortAsc((v) => !v)
    } else {
      setSortBy(key)
      setSortAsc(key === 'name') // name: ก→ฮ, time: newest first
    }
  }

  const provinces = useMemo(
    () =>
      [...new Set(fires.map((f) => f.province).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'th'),
      ),
    [fires],
  )

  const satellites = useMemo(
    () => [...new Set(fires.map((f) => f.satellite).filter(Boolean))].sort(),
    [fires],
  )

  const filteredFires = useMemo(() => {
    let result = fires
    if (statusFilter === 'free') result = result.filter((f) => !f.status && !f.booked)
    else if (statusFilter === 'booked') result = result.filter((f) => !f.status && f.booked)
    else if (statusFilter === 'resolved') result = result.filter((f) => f.status)
    if (provinceFilter) result = result.filter((f) => f.province === provinceFilter)
    if (satelliteFilter) result = result.filter((f) => f.satellite === satelliteFilter)
    return result
  }, [fires, statusFilter, provinceFilter, satelliteFilter])

  const listFires = useMemo(() => {
    const sorted = [...filteredFires]
    const dir = sortAsc ? 1 : -1
    if (sortBy === 'name') {
      sorted.sort((a, b) => dir * a.name.localeCompare(b.name, 'th'))
    } else {
      sorted.sort((a, b) => dir * (new Date(a.detected_at) - new Date(b.detected_at)))
    }
    return sorted
  }, [filteredFires, sortBy, sortAsc])

  // the map shows the same fires the list does
  const points = useMemo(
    () => filteredFires.map((f) => ({ id: f.id, lat: f.lat, lng: f.lng, status: f.status, booked: f.booked })),
    [filteredFires],
  )

  const focusedId = useMapSelection((s) => s.focusedId)
  const clearSelection = useMapSelection((s) => s.clear)
  const focused = focusedId ? fires.find((f) => f.id === focusedId) : null

  return (
    <div className="flex flex-1 w-full overflow-hidden">
      <div className="relative w-3/4 h-full">
        <Map ref={mapRef} layer={selectedLayer} points={points} startPoint={startPoint} startZoom={home.zoom} officers={showOfficers ? officers : []} />
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
          <div
            id="layers"
            className="flex rounded-lg overflow-hidden shadow-md divide-x divide-gray-300"
          >
            {Object.keys(LAYERS).map((key) => (
              <button
                key={key}
                className={`px-3 py-1.5 text-sm font-medium hover:bg-forest-500 hover:text-primary-foreground ${selectedLayer === LAYERS[key] ? 'bg-forest-500 text-primary-foreground' : 'bg-white'}`}
                onClick={() => setSelectedLayer(LAYERS[key])}
              >
                {key}
              </button>
            ))}
          </div>
          <button
            title="กลับไปจุดเริ่มต้น"
            className="flex items-center gap-1.5 bg-white rounded-lg shadow-md px-3 py-1.5 text-sm font-medium hover:bg-forest-500 hover:text-primary-foreground"
            onClick={() => mapRef.current?.resetView()}
          >
            <ArrowsPointingOutIcon className="w-5 h-5" />
            กลับไปจุดเริ่มต้น
          </button>
          {canViewOfficers && (
          <button
            title={showOfficers ? 'ซ่อนเจ้าหน้าที่' : 'แสดงเจ้าหน้าที่'}
            aria-pressed={showOfficers}
            className={`flex items-center gap-1.5 rounded-lg shadow-md px-3 py-1.5 text-sm font-medium hover:bg-forest-500 hover:text-primary-foreground ${showOfficers ? 'bg-forest-500 text-primary-foreground' : 'bg-white'}`}
            onClick={() => setShowOfficers((v) => !v)}
          >
            <UserGroupIcon className="w-5 h-5" />
            {showOfficers ? 'ซ่อนเจ้าหน้าที่' : 'แสดงเจ้าหน้าที่'}
          </button>
          )}
        </div>
      </div>
      <div className="relative w-1/4 h-full">
        {/* list panel stays mounted while the expanded card overlays it,
            so the scroll position is kept naturally */}
        <div
          className="h-full bg-background overflow-hidden flex flex-col"
          id="map-controller"
        >
          <div id="list-controls" className="px-3 py-2 space-y-2 bg-white border-b border-gray-300">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-md">รายการไฟ ({listFires.length})</p>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-500">เรียงตาม</span>
                {[{ key: 'time', label: 'เวลา' }, { key: 'name', label: 'ชื่อ' }].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => changeSort(key)}
                    className={`px-2.5 py-1 rounded-full text-sm font-semibold transition-colors ${
                      sortBy === key
                        ? 'bg-forest-500 text-white'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {label}{sortBy === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-0">
                <span className="block text-xs text-gray-500 mb-0.5">สถานะ</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-300 rounded-lg px-2 py-1"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="free">ลุกไหม้</option>
                  <option value="booked">ถูกจอง</option>
                  <option value="resolved">ดับแล้ว</option>
                </select>
              </label>
              <label className="flex-1 min-w-0">
                <span className="block text-xs text-gray-500 mb-0.5">จังหวัด</span>
                <select
                  value={provinceFilter}
                  onChange={(e) => setProvinceFilter(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-300 rounded-lg px-2 py-1"
                >
                  <option value="">ทั้งหมด</option>
                  {provinces.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="flex-1 min-w-0">
                <span className="block text-xs text-gray-500 mb-0.5">ดาวเทียม</span>
                <select
                  value={satelliteFilter}
                  onChange={(e) => setSatelliteFilter(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-300 rounded-lg px-2 py-1"
                >
                  <option value="">ทั้งหมด</option>
                  {satellites.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div
            id="controller"
            className="flex-1 min-h-0 cursor-pointer"
          >
            <List
              className="no-scrollbar"
              rowComponent={FireRow}
              rowCount={listFires.length}
              rowHeight={CARD_HEIGHT}
              rowProps={{ fires: listFires }}
            />
          </div>
        </div>
        {focused && (
          <div className="absolute inset-0 z-10 bg-white py-2 overflow-hidden flex flex-col">
            <button
              className="bg-white p-1 w-fit"
              onClick={clearSelection}
            >
              <svg className="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16">
                <path fillRule="evenodd"
                    d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z" />
              </svg>
            </button>
            <ExpandedCard fire={focused} officers={officers} />
          </div>
        )}
      </div>
    </div>
  )
}
