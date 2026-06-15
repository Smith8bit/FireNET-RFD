import axios from 'axios'
import { create } from 'zustand'
import { api } from '@/lib/api'

export type ResolvePhoto = {
  uri: string // local file uri (already compressed)
  gps: { latitude: number; longitude: number } | null
}

export type Fire = {
  id: string
  name: string
  lat: number
  lng: number
  status: boolean
  expired?: boolean // status was set by auto-expiry, not an officer
  false_alarm?: boolean // closed as a false detection (no real fire), no photo evidence
  booked: boolean
  detected_at: string
  tumboon: string | null
  aumper: string | null
  province: string | null
  type: string | null
}

type FireState = {
  fires: Fire[]
  selectedFireId: string | null
  reservedFire: Fire | null
  loading: boolean
  online: boolean
  loadFires: () => Promise<void>
  selectFire: (id: string | null) => void
  reserveFire: (fire: Fire) => Promise<void>
  resolveFire: (note: string, photos: ResolvePhoto[]) => Promise<void>
  reportFalseFire: (note: string) => Promise<void>
  loadReservedFire: () => Promise<void>
  loadStatus: () => Promise<void>
  setOnline: (online: boolean, coords?: { latitude: number; longitude: number }) => Promise<void>
  pushLocation: (coords: { latitude: number; longitude: number }) => Promise<void>
}

export const useFireStore = create<FireState>((set, get) => ({
  fires: [],
  selectedFireId: null,
  reservedFire: null,
  loading: false,
  online: false,

  loadFires: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await api.get<Fire[]>('/fires')
      set({ fires: res.data })
    } catch {
    } finally {
      set({ loading: false })
    }
  },

  selectFire: (id) => set({ selectedFireId: id }),

  reserveFire: async (fire) => {
    try {
      const res = await api.patch<Fire | null>('/officers/me/fire', { fire_id: fire.id })
      set({ reservedFire: res.data ?? fire })
      get().loadFires() // refresh booked flags for the list
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 403) {
        throw new Error('ไฟนี้อยู่นอกพื้นที่รับผิดชอบของคุณ')
      }
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        const detail = (e.response.data as { detail?: string } | undefined)?.detail
        if (detail === 'officer already holds an unresolved fire') {
          throw new Error('คุณมีไฟที่จองอยู่แล้ว ต้องดับไฟเดิมก่อนจึงจะจองจุดใหม่ได้')
        }
        if (detail === 'officer offline') {
          throw new Error('คุณต้องออนไลน์ก่อนจึงจะจองได้')
        }
        throw new Error('ไฟนี้ถูกเจ้าหน้าที่ท่านอื่นจองแล้ว')
      }
      throw new Error('ไม่สามารถจองไฟนี้ได้ กรุณาลองใหม่อีกครั้ง')
    }
  },

  resolveFire: async (note, photos) => {
    const form = new FormData()
    if (note.trim()) form.append('note', note.trim())
    form.append('image_gps', JSON.stringify(photos.map((p) => p.gps)))
    photos.forEach((p, i) => {
      form.append('images', { uri: p.uri, name: `photo-${i}.jpg`, type: 'image/jpeg' } as any)
    })
    let resolved: Fire | null = null
    try {
      const res = await api.post<Fire>('/officers/me/fire/resolve', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000, // photo upload on a field network
      })
      resolved = res.data
    } catch (e) {
      if (
        axios.isAxiosError(e) &&
        e.response?.status === 409 &&
        (e.response.data as { detail?: string } | undefined)?.detail === 'officer offline'
      ) {
        throw new Error('คุณต้องออนไลน์ก่อนจึงจะบันทึกการดับไฟได้')
      }
      throw new Error('ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง')
    }
    // keep showing the fire, now marked as resolved (status=true, booked=false)
    set({ reservedFire: resolved })
    get().loadFires() // fire status changed → refresh the map list
  },

  // close a reserved fire as a false detection — no photo evidence required
  reportFalseFire: async (note) => {
    let resolved: Fire | null = null
    try {
      const res = await api.post<Fire>('/officers/me/fire/false-report', {
        note: note.trim() || undefined,
      })
      resolved = res.data
    } catch (e) {
      if (
        axios.isAxiosError(e) &&
        e.response?.status === 409 &&
        (e.response.data as { detail?: string } | undefined)?.detail === 'officer offline'
      ) {
        throw new Error('คุณต้องออนไลน์ก่อนจึงจะรายงานได้')
      }
      throw new Error('ไม่สามารถรายงานว่าไม่ใช่ไฟได้ กรุณาลองใหม่อีกครั้ง')
    }
    set({ reservedFire: resolved })
    get().loadFires() // fire status changed → refresh the map list
  },

  // explicit user-driven status change; sends the `active` flag
  setOnline: async (online, coords) => {
    try {
      await api.patch('/officers/me/location', { ...coords, active: online })
      set({ online })
    } catch {
      throw new Error('ไม่สามารถเปลี่ยนสถานะได้ กรุณาลองใหม่อีกครั้ง')
    }
  },

  // periodic heartbeat: refresh position only, never touch the online flag, so a
  // poll that lands after the user toggles off can't silently re-activate them
  pushLocation: async (coords) => {
    try {
      await api.patch('/officers/me/location', coords)
    } catch {}
  },

  loadReservedFire: async () => {
    try {
      const res = await api.get<Fire | null>('/officers/me/fire')
      set({ reservedFire: res.data ?? null })
    } catch {}
  },

  // restore the server-side online flag after an app restart
  loadStatus: async () => {
    try {
      const res = await api.get<{ active: boolean }>('/officers/me/status')
      set({ online: res.data.active })
    } catch {}
  },
}))
