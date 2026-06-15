import { useMemo } from 'react'
import { useSocketStore } from './stateStore'

function normalize(raw) {
  return raw.map((f) => ({
    id: f.id,
    name: f.name,
    detected_at: f.detected_at,
    date: f.detected_at?.split('T')[0] ?? '',
    time: f.detected_at?.split('T')[1]?.split('+')[0]?.slice(0, 5) ?? '',
    type: f.type,
    status: f.status,
    booked: f.booked,
    holder_id: f.holder_id,
    holder_name: f.holder_name,
    lat: f.lat,
    lng: f.lng,
    tumboon: f.tumboon,
    aumper: f.aumper,
    province: f.province
  }))
}

export function useFireData() {
  const live = useSocketStore((s) => s.byType['fires'])
  const source = Array.isArray(live?.fires) ? live.fires : []
  return useMemo(() => normalize(source), [source])
}