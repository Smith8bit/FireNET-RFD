import { useMemo } from 'react'
import { useSocketStore } from './stateStore'

/**
 * Project raw server fire records into the flat, UI-friendly shape components expect.
 * Its main job is to pre-split the ISO `detected_at` timestamp into display-ready
 * `date`/`time` strings once, so list/card components don't parse dates on every render.
 * @param {object[]} raw  Fire records straight from the socket store.
 * @returns {object[]} Normalized fires with derived `date` (YYYY-MM-DD) and `time` (HH:MM).
 */
function normalize(raw) {
  return raw.map((f) => ({
    id: f.id,
    name: f.name,
    detected_at: f.detected_at,
    resolve_time: f.resolve_time,
    // Derive date/time by string-splitting the ISO timestamp (cheaper than Date parsing
    // and timezone-agnostic): 'YYYY-MM-DDTHH:MM:SS+07:00' -> date 'YYYY-MM-DD', time 'HH:MM'.
    // Optional chaining + '' fallback guards against a null/malformed detected_at.
    date: f.detected_at?.split('T')[0] ?? '',
    time: f.detected_at?.split('T')[1]?.split('+')[0]?.slice(0, 5) ?? '',
    type: f.type,
    status: f.status,
    expired: f.expired,
    false_alarm: f.false_alarm,
    booked: f.booked,
    appointed: f.appointed,
    holder_id: f.holder_id,
    holder_name: f.holder_name,
    lat: f.lat,
    lng: f.lng,
    tumboon: f.tumboon,
    aumper: f.aumper,
    province: f.province,
    satellite: f.satellite
  }))
}

/**
 * Hook exposing the live, normalized fire list to components.
 * @returns {object[]} Normalized fires; empty array until the first snapshot arrives.
 * @remarks Memoized on the raw source array — the socket store replaces that array by
 *   reference on every update, so normalize() only re-runs when the data actually changes.
 */
export function useFireData() {
  const live = useSocketStore((s) => s.byType['fires'])
  const source = Array.isArray(live?.fires) ? live.fires : [] // guard the pre-connect/undefined state.
  return useMemo(() => normalize(source), [source])
}