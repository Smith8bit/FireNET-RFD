import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Map, Camera, GeoJSONSource, Layer, type CameraRef, type StyleSpecification } from '@maplibre/maplibre-react-native'
import base from '@/assets/layers/base.json'
import { View, Text, StyleSheet, Pressable, useWindowDimensions, TouchableOpacity, Alert, Switch } from 'react-native';
import * as Location from 'expo-location';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetFlatList, type BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFireStore, type Fire } from '@/stores/fireStore';
import { useAuthSession } from '@/providers/AuthProvider';
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
    })),
  }
}

const ROW_HEIGHT = 64

type FireRowProps = {
  item: Fire
  selected: boolean
  isHeld: boolean
  bookedByOther: boolean
  disabled: boolean
  online: boolean
  color: string
  onFocus: (fire: Fire) => void
  onReserve: (fire: Fire) => void
}

// memoized so selection/status changes only re-render the affected rows
const FireRow = React.memo(function FireRow({
  item,
  selected,
  isHeld,
  bookedByOther,
  disabled,
  online,
  color,
  onFocus,
  onReserve,
}: FireRowProps) {
  return (
    <Pressable
      style={[styles.fireRow, selected && styles.fireRowSelected, !online && styles.fireRowOffline]}
      disabled={!online}
      onPress={() => onFocus(item)}
    >
      <View style={[styles.fireDot, { backgroundColor: color }]} />
      <View style={styles.fireInfo}>
        <Text style={[styles.fireName, selected && styles.fireNameSelected]}>
          {item.name}
        </Text>
        <Text style={styles.fireTime}>{formatDetectedAt(item.detected_at)}</Text>
      </View>
      <TouchableOpacity
        style={[styles.reserveButton, disabled && !isHeld && styles.reserveButtonDisabled]}
        disabled={disabled}
        onPress={() => onReserve(item)}
      >
        <Text style={styles.reserveButtonText}>
          {item.status ? 'ดับแล้ว' : isHeld ? 'จองแล้ว' : bookedByOther ? 'ถูกจอง' : 'ว่าง'}
        </Text>
      </TouchableOpacity>
    </Pressable>
  )
})

export default function MapView() {
  const fires = useFireStore((s) => s.fires)
  const selectedFireId = useFireStore((s) => s.selectedFireId)
  const loadFires = useFireStore((s) => s.loadFires)
  const selectFire = useFireStore((s) => s.selectFire)
  const reserveFire = useFireStore((s) => s.reserveFire)
  const reservedFire = useFireStore((s) => s.reservedFire)
  const loadReservedFire = useFireStore((s) => s.loadReservedFire)
  const online = useFireStore((s) => s.online)
  const setOnline = useFireStore((s) => s.setOnline)
  const { refresh } = useAuthSession()

  // reload covers all three tabs: fire list (map), reserved fire (Firespot), profile (Setting)
  const reloadAll = useCallback(() => {
    loadFires()
    loadReservedFire()
    refresh()
  }, [loadFires, loadReservedFire, refresh])
  const [toggling, setToggling] = useState(false)
  const [sortBy, setSortBy] = useState<'time' | 'name'>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const bottomSheetRef = useRef<BottomSheet>(null)
  const listRef = useRef<BottomSheetFlatListMethods>(null)
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

  const sortedFires = useMemo(() => {
    const sorted = [...fires]
    const dir = sortAsc ? 1 : -1
    if (sortBy === 'name') {
      sorted.sort((a, b) => dir * a.name.localeCompare(b.name, 'th'))
    } else {
      sorted.sort(
        (a, b) => dir * (new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()),
      )
    }
    return sorted
  }, [fires, sortBy, sortAsc])

  // tap the active chip again to flip direction; a new key gets its natural default
  const changeSort = useCallback(
    (key: 'time' | 'name') => {
      if (sortBy === key) {
        setSortAsc((v) => !v)
      } else {
        setSortBy(key)
        setSortAsc(key === 'name') // name: ก→ฮ, time: newest first
      }
    },
    [sortBy],
  )
  const snapPoints = useMemo(() => ['14%', '60%'], [])

  const toggleOnline = useCallback(
    async (value: boolean) => {
      setToggling(true)
      try {
        if (value) {
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (status !== 'granted') {
            Alert.alert('ไม่สามารถออนไลน์ได้', 'กรุณาอนุญาตให้แอปเข้าถึงตำแหน่งที่ตั้ง')
            return
          }
          // go online immediately; the layout poll pushes the first GPS fix
          await setOnline(true)
        } else {
          // go offline immediately — never block on a GPS fix; attach a cached
          // position if one is already available (instant), otherwise send none
          let coords: { latitude: number; longitude: number } | undefined
          try {
            const last = await Location.getLastKnownPositionAsync()
            if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude }
          } catch {}
          await setOnline(false, coords)
        }
      } catch (e) {
        Alert.alert(
          'เปลี่ยนสถานะไม่สำเร็จ',
          e instanceof Error ? e.message : 'ไม่สามารถเปลี่ยนสถานะได้ กรุณาลองใหม่อีกครั้ง',
        )
      } finally {
        setToggling(false)
      }
    },
    [setOnline],
  )

  // scroll the bottom-sheet list so this fire's row is at the top
  const scrollToFire = useCallback(
    (fire: Fire) => {
      const index = sortedFires.findIndex((f) => f.id === fire.id)
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
      }
    },
    [sortedFires],
  )

  const focusFire = useCallback(
    (fire: Fire) => {
      if (!online) return
      selectFire(fire.id)
      bottomSheetRef.current?.snapToIndex(1)
      cameraRef.current?.flyTo({
        center: [fire.lng, fire.lat],
        zoom: 14,
        padding: { bottom: height * 0.5 },
        duration: 1000,
      })
    },
    [height, selectFire, online],
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
      const isHeld = item.id === heldFireId
      const bookedByOther = item.booked && !isHeld
      return (
        <FireRow
          item={item}
          selected={item.id === selectedFireId}
          isHeld={isHeld}
          bookedByOther={bookedByOther}
          disabled={!online || item.status || holdingUnresolved || bookedByOther}
          online={online}
          color={fireColor(item, heldFireId)}
          onFocus={focusFire}
          onReserve={reserve}
        />
      )
    },
    [focusFire, reserve, selectedFireId, heldFireId, holdingUnresolved, online],
  )

  const keyExtractor = useCallback((item: Fire) => item.id, [])

  // fixed row height: no async measurement, and scrollToIndex is always exact
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }),
    [],
  )

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
              scrollToFire(fire)
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
      <TouchableOpacity style={styles.reloadButton} onPress={reloadAll}>
        <Ionicons name="refresh" size={20} color="#000000" />
      </TouchableOpacity>
      <View style={styles.onlineToggle}>
        <View style={[styles.onlineDot, { backgroundColor: online ? '#22c55e' : '#9ca3af' }]} />
        <Text style={styles.onlineLabel}>{online ? 'ออนไลน์' : 'ออฟไลน์'}</Text>
        <Switch
          value={online}
          onValueChange={toggleOnline}
          disabled={toggling}
          trackColor={{ false: '#d1d5db', true: '#86efac' }}
          thumbColor={online ? '#22c55e' : '#f4f4f5'}
        />
      </View>
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>รายการไฟ ({fires.length})</Text>
          <View style={styles.sortGroup}>
            <Text style={styles.sortLabel}>เรียงตาม</Text>
            <TouchableOpacity
              style={[styles.sortButton, sortBy === 'time' && styles.sortButtonActive]}
              onPress={() => changeSort('time')}
            >
              <Text style={[styles.sortText, sortBy === 'time' && styles.sortTextActive]}>เวลา</Text>
              {sortBy === 'time' && (
                <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={12} color="#ffffff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortBy === 'name' && styles.sortButtonActive]}
              onPress={() => changeSort('name')}
            >
              <Text style={[styles.sortText, sortBy === 'name' && styles.sortTextActive]}>ชื่อ</Text>
              {sortBy === 'name' && (
                <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={12} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
        <BottomSheetFlatList
          ref={listRef}
          data={sortedFires}
          keyExtractor={keyExtractor}
          renderItem={renderFire}
          getItemLayout={getItemLayout}
          windowSize={7}
          maxToRenderPerBatch={12}
          initialNumToRender={12}
          removeClippedSubviews
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
  onlineToggle: {
    position: 'absolute',
    top: 40,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  onlineLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginRight: 6,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginLeft: 6,
  },
  sortButtonActive: {
    backgroundColor: '#f59e0b',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  sortTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingBottom: 24,
  },
  fireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT, // must match getItemLayout
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  fireRowSelected: {
    backgroundColor: '#fef3c7',
  },
  fireRowOffline: {
    opacity: 0.5,
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
