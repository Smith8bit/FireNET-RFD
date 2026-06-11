import axios from 'axios'
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Map, Camera, GeoJSONSource, Layer, type CameraRef, type StyleSpecification } from '@maplibre/maplibre-react-native'
import base from '@/assets/layers/base.json'
import { View, Text, StyleSheet, Pressable, useWindowDimensions, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';

const API_URL = process.env.EXPO_PUBLIC_API_URL! // fallback for emulator: 'http://10.0.2.2:8000'
const MAP_STYLE = base as unknown as StyleSpecification
const THAILAND_CENTER: [number, number] = [100.523186, 13.736717]

type Fire = { id: string; name: string; lat: number; lng: number; status: boolean; detected_at: string; tumboon: string; aumper: string; province: string; type: string }

function formatDetectedAt(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toGeoJSON(fires: Fire[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fires.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: { id: f.id, name: f.name, staus: f.status, time: f.detected_at },
      details: { tumboon: f.tumboon, aumper: f.aumper, province: f.province }
    })),
  }
}

export default function MapView() {
  const [fires, setFires] = useState<Fire[]>([])
  const [selectedFireId, setSelectedFireId] = useState<string | null>(null)
  const bottomSheetRef = useRef<BottomSheet>(null)
  const cameraRef = useRef<CameraRef>(null)
  const { height } = useWindowDimensions()

  const loadingRef = useRef(false)

  const loadFires = useCallback(() => {
    if (loadingRef.current) return
    loadingRef.current = true
    axios
      .get<Fire[]>(`${API_URL}/fires`, { withCredentials: true })
      .then((res) => setFires(res.data))
      .catch(() => { })
      .finally(() => {
        loadingRef.current = false
      })
  }, [])

  // Fetch fires on mount
  useEffect(() => {
    loadFires()
  }, [loadFires])

  const firesGeoJSON = useMemo(() => toGeoJSON(fires), [fires])
  const snapPoints = useMemo(() => ['12%', '60%', '100%'], [])

  const focusFire = useCallback(
    (fire: Fire) => {
      setSelectedFireId(fire.id)
      bottomSheetRef.current?.snapToIndex(1)
      cameraRef.current?.flyTo({
        center: [fire.lng, fire.lat],
        zoom: 14,
        padding: { bottom: height * 0.5 },
        duration: 1000,
      })
    },
    [height],
  )

  const renderFire = useCallback(
    ({ item }: { item: Fire }) => {
      const selected = item.id === selectedFireId
      return (
        <Pressable style={[styles.fireRow, selected && styles.fireRowSelected]} onPress={() => focusFire(item)}>
          <View style={[styles.fireDot, selected && styles.fireDotSelected]} />
          <View style={styles.fireInfo}>
            <Text style={[styles.fireName, selected && styles.fireNameSelected]}>
              {item.name}
            </Text>
            <Text style={styles.fireTime}>{formatDetectedAt(item.detected_at)}</Text>
          </View>
          <TouchableOpacity style={styles.reserveButton} onPress={() => console.log('Pressed')}>
            <Text style={styles.reserveButtonText}>จอง</Text>
          </TouchableOpacity>
        </Pressable>
      )
    },
    [focusFire, selectedFireId],
  )

  const keyExtractor = useCallback((item: Fire) => item.id, [])

  return (
    <GestureHandlerRootView style={styles.container}>
      
      <Map
        style={styles.container}
        mapStyle={MAP_STYLE}
        onPress={() => setSelectedFireId(null)}
      >
        <Camera ref={cameraRef} initialViewState={{ center: THAILAND_CENTER, zoom: 6 }} />
        <GeoJSONSource
          id="fires"
          data={firesGeoJSON}
          onPress={(e) => {
            const feature = e.nativeEvent.features[0]
            const fire = fires.find((f) => f.id === feature?.properties?.id)
            if (fire) {
              e.stopPropagation()
              focusFire(fire)
            }
          }}
        >
          <Layer
            type="circle"
            id="fire-circles"
            paint={{
              'circle-color': [
                'case',
                ['==', ['get', 'id'], selectedFireId ?? ''],
                '#f59e0b',
                '#ef4444',
              ],
              'circle-radius': [
                'case',
                ['==', ['get', 'id'], selectedFireId ?? ''],
                10,
                6,
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': [
                'case',
                ['==', ['get', 'id'], selectedFireId ?? ''],
                2.5,
                1.5,
              ],
            }}
          />
        </GeoJSONSource>
      </Map>
      <TouchableOpacity style={styles.reloadButton} onPress={loadFires}>
        <Ionicons name="refresh" size={20} color="#000000" />
      </TouchableOpacity>
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
      >
        <Text style={styles.sheetTitle}>รายการไฟ ({fires.length})</Text>
        <BottomSheetFlatList
          data={fires}
          keyExtractor={keyExtractor}
          renderItem={renderFire}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No active fires</Text>}
        />
      </BottomSheet>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  reloadButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
  fireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  fireRowSelected: {
    backgroundColor: '#fef3c7',
  },
  fireDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    marginRight: 12,
  },
  fireDotSelected: {
    backgroundColor: '#f59e0b',
  },
  fireName: {
    fontSize: 15,
  },
  fireNameSelected: {
    fontWeight: '600',
  },
  fireTime: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  fireInfo: {
    flex: 1,
  },
  reserveButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginLeft: 12,
  },
  reserveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
    color: '#9ca3af',
  },
})
