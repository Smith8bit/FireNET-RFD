import base from '@/assets/layers/base.json';
import { colors } from '@/lib/theme';
import { useAuthSession } from '@/providers/AuthProvider';
import { useFireStore, type Fire } from '@/stores/fireStore';
import { formatDetectedAt } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetFlatList, type BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef, type StyleSpecification } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Switch, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const MAP_STYLE = base as unknown as StyleSpecification

// floating map controls' shadow — kept inline since it has no faithful className
const floatShadow = {
  elevation: 4,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
}
const THAILAND_CENTER: [number, number] = [100.523186, 13.736717]

const FIRE_COLORS = {
  resolved: '#d1d5dc', // ดับแล้ว
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

const ROW_HEIGHT = 96

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
      className={`flex-row items-center border-b-[0.75px] border-border px-6 ${selected ? 'bg-flame-light' : ''} ${!online ? 'opacity-50' : ''}`}
      style={{ height: ROW_HEIGHT }} // must match getItemLayout
      disabled={!online}
      onPress={() => onFocus(item)}
    >
      <View className="flex-1">
        <Text className={`text-lg  font-sans-medium ${selected ? 'text-primary' : 'text-card-foreground'}`}>
          {item.name}
        </Text>
        <Text className="mt-1 text-sm font-head text-gray-500" numberOfLines={1}>
          {[item.tumboon, item.aumper, item.province].filter(Boolean).join(' · ') || '-'}
        </Text>
        
        <View className='mt-1 flex-row align-middle gap-2'>
          <Text className={`text-md font-sans-semibold ${item.status ? 'text-gray-400' : isHeld ? 'text-orange-500' : bookedByOther ? 'text-amber-400' : 'text-primary'}`}>
            {item.status ? 'ดับแล้ว' : isHeld ? 'จองแล้ว' : bookedByOther ? 'ถูกจอง' : 'ว่าง'}
          </Text>
          <Text className='text-sm'>·</Text>
          <Text className="text-sm font-head text-gray-500">{formatDetectedAt(item.detected_at)}</Text>
        </View>
      </View>

      {!disabled && !isHeld && (
        <TouchableOpacity
          className='items-center justify-center '
          disabled={disabled}
          onPress={() => onReserve(item)}
        >
          <Ionicons name="arrow-forward-outline" size={32} color="#FF4000" />
        </TouchableOpacity>
      )}
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
  const { user, refresh } = useAuthSession()

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

  // ask for location permission on mount so the blue "you are here" puck can
  // render (like Google Maps) without waiting for the officer to go online
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().catch(() => {})
  }, [])

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
  const snapPoints = useMemo(() => ['5%', '60%', ], [])

  // open the map on the officer's own region (served by /users/me/profile);
  // initialViewState is read once on mount, and the layout guard guarantees
  // `user` is loaded by then. Fall back to a whole-Thailand view.
  const initialViewState = useMemo(() => {
    const home = user?.home
    return {
      center: home ? ([home.lng, home.lat] as [number, number]) : THAILAND_CENTER,
      zoom: home?.zoom ?? 6,
    }
  }, [user?.home])

  // fly back to the officer's region (the same view the map opened on)
  const recenter = useCallback(() => {
    cameraRef.current?.flyTo({
      center: initialViewState.center,
      zoom: initialViewState.zoom,
      duration: 1000,
    })
  }, [initialViewState])

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
    <GestureHandlerRootView style={{ flex: 1 }}>

      <Map
        style={{ flex: 1 }}
        mapStyle={MAP_STYLE}
        onPress={() => selectFire(null)}
      >
        <Camera ref={cameraRef} initialViewState={initialViewState} />
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

        {/* blue "you are here" puck, like Google Maps; renders once location
            permission is granted. Placed last so it draws above the fire dots. */}
        <UserLocation animated accuracy />
      </Map>

      <TouchableOpacity
        className="absolute z-10 bottom-4 right-4 h-16 w-16 items-center justify-center rounded-full bg-secondary"
        style={floatShadow}
        onPress={reloadAll}
      >
        <Ionicons name="refresh" size={26} color={'#FFFFFF'} />
      </TouchableOpacity>

      <TouchableOpacity
        className="absolute left-5 top-10 h-10 w-10 items-center justify-center rounded-full bg-white"
        style={floatShadow}
        onPress={recenter}
      >
        <Ionicons name="locate" size={20} color={colors.accent} />
      </TouchableOpacity>

      <View
        className="absolute self-center top-10 flex-row items-center rounded-3xl bg-white px-3.5 py-1.5"
        style={floatShadow}
      >
        <View className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: online ? '#22c55e' : '#9ca3af' }} />
        <Text className="mr-2.5 text-sm font-sans-semibold text-accent">{online ? 'ออนไลน์' : 'ออฟไลน์'}</Text>
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
        handleStyle={{padding: 20}}
      >
        <View className="flex-row items-center justify-between px-4 pb-4 border-gray-300 border-b">
          <Text className="text-xl font-sans-semibold text-accent">รายการไฟ ({fires.length})</Text>
          <View className="flex-row items-center">
            <Text className="mr-1.5 text-sm font-head text-gray-500">เรียงตาม</Text>
            <TouchableOpacity
              className={`ml-1.5 flex-row items-center gap-0.5 rounded-xl px-2.5 py-1 ${sortBy === 'time' ? 'bg-primary' : 'bg-muted'}`}
              onPress={() => changeSort('time')}
            >
              <Text className={`text-sm font-sans-semibold ${sortBy === 'time' ? 'text-white' : 'text-gray-500'}`}>เวลา</Text>
              {sortBy === 'time' && (
                <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={12} color="#ffffff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              className={`ml-1.5 flex-row items-center gap-0.5 rounded-xl px-2.5 py-1 ${sortBy === 'name' ? 'bg-primary' : 'bg-muted'}`}
              onPress={() => changeSort('name')}
            >
              <Text className={`text-sm font-sans-semibold ${sortBy === 'name' ? 'text-white' : 'text-gray-500'}`}>ชื่อ</Text>
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
          // contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text className="py-6 text-center font-head text-gray-400">No active fires</Text>}
        />
      </BottomSheet>
    </GestureHandlerRootView>
  )
}
