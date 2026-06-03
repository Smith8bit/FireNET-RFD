import { useMemo, useState } from 'react'
import { useMapSelection } from '../functions/stateStore'
import { useFireData, firePopupHtml } from '../functions/useFireData'
import Map from '../components/map'
import Card from '../components/card'
import ExpandedCard from '../components/expandedCard'

import satelliteStyle from '../components/layers/satellite.json'
import baseStyle from '../components/layers/base.json'
import topoStyle from '../components/layers/topo.json'

const LAYERS = { Base: baseStyle, Satellite: satelliteStyle, Topo: topoStyle }
const START_POINT = { lat: 13.736717, lng: 100.523186 }

export default function MapViewPage() {
  const [selectedLayer, setSelectedLayer] = useState(LAYERS.Base)

  const fires = useFireData()
  const points = useMemo(
    () => fires.map((f) => ({ id: f.id, lat: f.lat, lng: f.lng, popupHtml: firePopupHtml(f) })),
    [fires],
  )

  const focusedId = useMapSelection((s) => s.focusedId)
  const clearSelection = useMapSelection((s) => s.clear)
  const focused = focusedId ? fires.find((f) => f.id === focusedId) : null

  return (
    <div className="flex flex-1 w-full overflow-hidden">
      <div className="w-3/4 h-full">
        <Map layer={selectedLayer} points={points} startPoint={START_POINT} />
      </div>
      {!focused ? (
        <div
          className="w-1/4 h-full bg-secondary p-2 overflow-hidden flex flex-col"
          id="map-controller"
        >
          <div id="layers" className="flex justify-center gap-2 m-1">
            {Object.keys(LAYERS).map((key) => (
              <button
                key={key}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-forest-700 transition-colors"
                onClick={() => setSelectedLayer(LAYERS[key])}
              >
                {key}
              </button>
            ))}
          </div>
          <div
            id="controller"
            className="p-2 h-fit overflow-y-scroll no-scrollbar cursor-pointer"
          >
            {fires.map((f) => (
              <Card
                key={f.id}
                id={f.id}
                Title={f.title}
                Type={f.type}
                Date={f.date}
                Time={f.time}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="w-1/4 h-full bg-secondary p-2 overflow-hidden flex flex-col">
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-forest-700 transition-colors"
            onClick={clearSelection}
          >
            Exit
          </button>
          <ExpandedCard fire={focused} />
        </div>
      )}
    </div>
  )
}
