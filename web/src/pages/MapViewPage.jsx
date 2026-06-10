import { useMemo, useState, useEffect } from 'react'
import { List } from 'react-window'
import { useMapSelection, useSocketStore } from '../functions/stateStore'
import { useFireData } from '../functions/useFireData'
import Map from '../components/map'
import Card from '../components/card'
import ExpandedCard from '../components/expandedCard'

import satelliteStyle from '../components/layers/satellite.json'
import baseStyle from '../components/layers/base.json'
import topoStyle from '../components/layers/topo.json'

const LAYERS = { Base: baseStyle, Satellite: satelliteStyle, Topo: topoStyle }
const START_POINT = { lat: 13.736717, lng: 100.523186 }
const CARD_HEIGHT = 125 // px — must match Card's rendered height (p-4 + 3 text lines + border)

function FireRow({ index, style, fires }) {
  const f = fires[index]
  return (
    <div style={style}>
      <Card id={f.id} Title={f.name} Area={f.type} Date={f.date} Time={f.time} />
    </div>
  )
}

export default function MapViewPage() {
  const [selectedLayer, setSelectedLayer] = useState(LAYERS.Base)

  const [officers, setOfficers] = useState([])
  const send = useSocketStore((s) => s.send)
  const ready = useSocketStore((s) => s.ready)
  const officersMsg = useSocketStore((s) => s.byType?.officers_map)

  useEffect(() => {
    if (!ready) return
    send({ type: 'list_officers_MAP' })
    console.log('SENT!')
  }, [ready])
    
  useEffect(() => {
    if (!officersMsg) return
    setOfficers(officersMsg.officers ?? [])
    console.log(officersMsg)
  }, [officersMsg])

  const fires = useFireData()
  const points = useMemo(
    () => fires.map((f) => ({ id: f.id, lat: f.lat, lng: f.lng })),
    [fires],
  )

  const focusedId = useMapSelection((s) => s.focusedId)
  const clearSelection = useMapSelection((s) => s.clear)
  const focused = focusedId ? fires.find((f) => f.id === focusedId) : null

  return (
    <div className="flex flex-1 w-full overflow-hidden">
      <div className="w-3/4 h-full">
        <Map layer={selectedLayer} points={points} startPoint={START_POINT} officers={officers} />
      </div>
      {!focused ? (
        <div
          className="w-1/4 h-full bg-background pb-2 overflow-hidden flex flex-col"
          id="map-controller"
        >
          <div id="layers" className="flex justify-center min-h-1/12 divide-x-2 divide-gray-300 ">
            {Object.keys(LAYERS).map((key) => (
              <button
                key={key}
                className={`flex-1 hover:bg-forest-500 hover:text-primary-foreground ${selectedLayer === LAYERS[key] ? 'bg-forest-500 text-primary-foreground' : 'bg-default'}`}
                onClick={() => setSelectedLayer(LAYERS[key])}
              >
                {key}
              </button>
            ))}
          </div>
          <div
            id="controller"
            className="flex-1 min-h-0 cursor-pointer"
          >
            <List
              className="no-scrollbar"
              rowComponent={FireRow}
              rowCount={fires.length}
              rowHeight={CARD_HEIGHT}
              rowProps={{ fires }}
            />
          </div>
        </div>
      ) : (
        <div className="w-1/4 h-full bg-white pb-2 overflow-hidden flex flex-col">
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
  )
}
