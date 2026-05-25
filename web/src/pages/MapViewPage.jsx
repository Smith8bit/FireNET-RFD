import { useState ,useEffect } from 'react'
import { useSocketStore } from '../functions/SocketStore'
import Map from '../components/map'

import satelliteStyle from '../components/layers/satellite.json'
import baseStyle from '../components/layers/base.json'
import topoStyle from '../components/layers/topo.json'

export default function MapViewPage() {

  const send = useSocketStore((s) => s.send)
  const ready = useSocketStore((s) => s.ready)
  const msg = useSocketStore((s) => s.lastMessage)

  const Layers = {
    Base: baseStyle,
    Satellite: satelliteStyle,
    Topo: topoStyle,
  }
  const Markers = {

  }

  const [selectedLayer, setSelectedLayer] = useState(Layers.Base)
  const [selectedMarkers, setSelectedMarkers] = useState([])

  return (
    <div className="flex flex-1 w-full overflow-hidden">
      <div className="w-4/5 h-full">
        <Map
          layer={selectedLayer}
          markers={selectedMarkers}
          startPoint={{ lat: 13.736717, lng: 100.523186 }}
        />
      </div>
      <div
        className="w-1/5 h-full bg-gray-100 p-4"
        id="map-controller">
        <div id="layers">
          {Object.keys(Layers).map((key) => (
            <button
              key={key}
              className="px-4 py-2 bg-blue-500 text-white rounded"
              onClick={() => setSelectedLayer(Layers[key])}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
        <div id="controller"></div>
      </div>
    </div>
  )
}