import { useMemo } from 'react'
import { useSocketStore } from './stateStore'

function normalize(raw) {
  return raw.map((f) => ({
    id: f.id,
    lat: f.lat,
    lng: f.lng,
    title: f.tumbon,
    type: f.name,
    date: f.date,
    time: f.time,
    raw: f.raw,
  }))
}

export function useFireData() {
  const live = useSocketStore((s) => s.lastMessage)
  const source = Array.isArray(live?.fires) ? live.fires : []
  return useMemo(() => normalize(source), [source])
}

export function firePopupHtml(f) {
  return `
    <div>
      <h3>${f.date ?? ''}</h3>
      <p>ตำบล: ${f.raw?.TUMBON ?? ''}</p>
      <p>อำเภอ: ${f.raw?.AUMPER ?? ''}</p>
      <p>จังหวัด: ${f.raw?.PROVINCE ?? ''}</p>
      <p>Lat/Lan: ${f.lat}/${f.lng}</p>
    </div>
  `
}
