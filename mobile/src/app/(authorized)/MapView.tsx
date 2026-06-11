import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { Map, Camera, GeoJSONSource, Layer, type CameraRef, type StyleSpecification } from '@maplibre/maplibre-react-native'
import base from '@/assets/layers/base.json'
import { View, Text, StyleSheet, Pressable, useWindowDimensions, TouchableOpacity, Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFireStore, type Fire } from '@/stores/fireStore';
import { formatDetectedAt } from '@/utils/format';

const MAP_STYLE = base as unknown as StyleSpecification
const THAILAND_CENTER: [number, number] = [100.523186, 13.736717]

const FIRE_COLORS = {
  resolved: '#22c55e', // ดับแล้ว
  held: '#f97316', // ไฟที่เราจอง
  booked: '#facc15', // ถูกเจ้าหน้าที่ท่านอื่นจอง
  free: '#ef4444', // ไฟอิสระ กำลังไหม้
}

function fireColor(fire: Fire, heldFireId: string | null): string {
  if (fire.status) return FIRE_COLORS.resolved
  if (fire.id === heldFireId) return FIRE_COLORS.held
  if (fire.booked) return FIRE_COLORS.booked
  return FIRE_COLORS.free
}

function toGeoJSON(fires: Fire[], heldFireId: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fires.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: {
        id: f.id,
        name: f.name,
        status: f.status,
        booked: f.booked,
        held: f.id === heldFireId,
        time: f.detected_at,
      },
      details: { tumboon: f.tumboon, aumper: f.aumper, province: f.province }
    })),
  }
}

export default function MapView() {
  const fires = useFireStore((s) => s.fires)
  const selectedFireId = useFireStore((s) => s.selectedFireId)
  const loadFires = useFireStore((s) => s.loadFires)
  const selectFire = useFireStore((s) => s.selectFire)
  const reserveFire = useFireStore((s) => s.reserveFire)
  const reservedFire = useFireStore((s) => s.reservedFire)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const bottomSheetRef = useRef<BottomSheet>(null)
  const cameraRef = useRef<CameraRef>(null)
  const { height } = useWindowDimensions()

  // Fetch fires and own reservation on mount
  useEffect(() => {
    loadFires()
    loadReservedFire()
  }, [loadFires, loadReservedFire])

  // จอง is locked while the officer holds an unresolved fire
  const heldFireId = reservedFire != null && !reservedFire.status ? reservedFire.id : null
  const holdingUnresolved = heldFireId != null

  const firesGeoJSON = useMemo(() => toGeoJSON(fires, heldFireId), [fires, heldFireId])
  const snapPoints = useMemo(() => ['14%', '60%', '100%'], [])

  const focusFire = useCallback(
    (fire: Fire) => {
      selectFire(fire.id)
      bottomSheetRef.current?.snapToIndex(1)
      cameraRef.current?.flyTo({
        center: [fire.lng, fire.lat],
        zoom: 14,
        padding: { bottom: height * 0.5 },
        duration: 1000,
      })
    },
    [height, selectFire],
  )

  const reserve = useCallback(
    async (fire: Fire) => {
      try {
        await reserveFire(fire)
        router.push('/Firespot')
      } catch (e) {
        Alert.alert(
          'จองไม่สำเร็จ',
          e instanceof Error ? e.message : 'ไม่สามารถจองไฟนี้ได้ กรุณาลองใหม่อีกครั้ง',
        )
      }
    },
    [reserveFire],
  )

  const renderFire = useCallback(
    ({ item }: { item: Fire }) => {
      const selected = item.id === selectedFireId
      const isHeld = item.id === heldFireId
      const bookedByOther = item.booked && !isHeld
      const disabled = item.status || holdingUnresolved || bookedByOther
      return (
        <Pressable style={[styles.fireRow, selected && styles.fireRowSelected]} onPress={() => focusFire(item)}>
          <View style={[styles.fireDot, { backgroundColor: fireColor(item, heldFireId) }]} />
          <View style={styles.fireInfo}>
            <Text style={[styles.fireName, selected && styles.fireNameSelected]}>
              {item.name}
            </Text>
            <Text style={styles.fireTime}>{formatDetectedAt(item.detected_at)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.reserveButton, disabled && !isHeld && styles.reserveButtonDisabled]}
            disabled={disabled}
            onPress={() => reserve(item)}
          >
            <Text style={styles.reserveButtonText}>
              {item.status ? 'ดับแล้ว' : isHeld ? 'จองแล้ว' : bookedByOther ? 'ถูกจอง' : 'ว่าง'}
            </Text>
          </TouchableOpacity>
        </Pressable>
      )
    },
    [focusFire, reserve, selectedFireId, heldFireId, holdingUnresolved],
  )

  const keyExtractor = useCallback((item: Fire) => item.id, [])

  return (
    <GestureHandlerRootView style={styles.container}>
      
      <Map
        style={styles.container}
        mapStyle={MAP_STYLE}
        onPress={() => selectFire(null)}
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
                ['==', ['get', 'status'], true],
                FIRE_COLORS.resolved,
                ['==', ['get', 'held'], true],
                FIRE_COLORS.held,
                ['==', ['get', 'booked'], true],
                FIRE_COLORS.booked,
                FIRE_COLORS.free,
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
    marginRight: 12,
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
  reserveButtonDisabled: {
    backgroundColor: '#d1d5db',
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
