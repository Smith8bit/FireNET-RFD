import { useMemo } from 'react'
import { useSocketStore } from './stateStore'
import staticData from '../components/markers/mockupData.json'
// import staticData from '../components/markers/blank.json'

function normalize(raw) {
  return raw.map((f, i) => ({
    id: `${f.DATE ?? ''}-${f.TIME ?? ''}-${f.LATITUDE}-${f.LONGITUDE}-${i}`,
    lat: f.LATITUDE,
    lng: f.LONGITUDE,
    title: f.TUMBOON,
    type: f.NAME,
    date: f.DATE,
    time: f.TIME,
    raw: f,
  }))
}

export function useFireData() {
  const live = useSocketStore((s) => s.lastMessage)
  const source = Array.isArray(live?.fires) ? live.fires : staticData
  return useMemo(() => normalize(source), [source])
}

export function firePopupHtml(f) {
  return `
    <div>
      <h3>${f.date ?? ''}</h3>
      <p>ตำบล: ${f.raw.TUMBOON ?? ''}</p>
      <p>อำเภอ: ${f.raw.AUMPER ?? ''}</p>
      <p>จังหวัด: ${f.raw.PROVINCE ?? ''}</p>
      <p>Lat/Lan: ${f.lat}/${f.lng}</p>
    </div>
  `
}
