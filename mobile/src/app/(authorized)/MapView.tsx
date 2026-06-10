import axios from 'axios'
import { useEffect, useState } from 'react'
import { Map, Camera, GeoJSONSource, Layer, type StyleSpecification } from '@maplibre/maplibre-react-native'
// import { Marker } from '@maplibre/maplibre-react-native'
// import { AntDesign } from '@expo/vector-icons'
// import { View } from 'react-native'
import base from '@/assets/layers/base.json'

const API_URL = process.env.EXPO_PUBLIC_API_URL! // fallback for emulator: 'http://10.0.2.2:8000'
const MAP_STYLE = base as unknown as StyleSpecification
const THAILAND_CENTER: [number, number] = [100.523186, 13.736717]

type Fire = { id: string; name: string; lat: number; lng: number }

function toGeoJSON(fires: Fire[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fires.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: { id: f.id, name: f.name },
    })),
  }
}

export default function MapView() {
  const [fires, setFires] = useState<Fire[]>([])

  useEffect(() => {
    axios
      .get<Fire[]>(`${API_URL}/fires`, { withCredentials: true })
      .then((res) => setFires(res.data))
      .catch(() => {})
  }, [])

  return (
    <Map style={{ flex: 1 }} mapStyle={MAP_STYLE}>
      <Camera initialViewState={{ center: THAILAND_CENTER, zoom: 6 }} />
      <GeoJSONSource
        id="fires"
        data={toGeoJSON(fires)}
        onPress={(e) => {
          const feature = e.nativeEvent.features[0]
          if (feature) console.log('tapped fire:', feature.properties?.name)
        }}
      >
        <Layer
          type="circle"
          id="fire-circles"
          paint={{
            'circle-color': '#ef4444',
            'circle-radius': 6,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          }}
        />
      </GeoJSONSource>
      {/* Marker version (kept for reference — worse performance at scale)
      {fires.map((f) => (
        <Marker key={f.id} id={f.id} lngLat={[f.lng, f.lat]}>
          <View>
            <AntDesign name="fire" size={24} color="#ef4444" />
          </View>
        </Marker>
      ))}
      */}
    </Map>
  )
}
