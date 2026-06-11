import axios from 'axios'
import { create } from 'zustand'

const API_URL = process.env.EXPO_PUBLIC_API_URL!

export type Fire = {
  id: string
  name: string
  lat: number
  lng: number
  status: boolean
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
  loadFires: () => Promise<void>
  selectFire: (id: string | null) => void
  reserveFire: (fire: Fire) => Promise<void>
  resolveFire: () => Promise<void>
  loadReservedFire: () => Promise<void>
}

export const useFireStore = create<FireState>((set, get) => ({
  fires: [],
  selectedFireId: null,
  reservedFire: null,
  loading: false,

  loadFires: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await axios.get<Fire[]>(`${API_URL}/fires`, { withCredentials: true })
      set({ fires: res.data })
    } catch {
    } finally {
      set({ loading: false })
    }
  },

  selectFire: (id) => set({ selectedFireId: id }),

  reserveFire: async (fire) => {
    try {
      const res = await axios.patch<Fire | null>(
        `${API_URL}/officers/me/fire`,
        { fire_id: fire.id },
        { withCredentials: true },
      )
      set({ reservedFire: res.data ?? fire })
      get().loadFires() // refresh booked flags for the list
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        const detail = (e.response.data as { detail?: string } | undefined)?.detail
        if (detail === 'officer already holds an unresolved fire') {
          throw new Error('คุณมีไฟที่จองอยู่แล้ว ต้องดับไฟเดิมก่อนจึงจะจองจุดใหม่ได้')
        }
        throw new Error('ไฟนี้ถูกเจ้าหน้าที่ท่านอื่นจองแล้ว')
      }
      throw new Error('ไม่สามารถจองไฟนี้ได้ กรุณาลองใหม่อีกครั้ง')
    }
  },

  resolveFire: async () => {
    let resolved: Fire | null = null
    try {
      const res = await axios.post<Fire>(`${API_URL}/officers/me/fire/resolve`, null, {
        withCredentials: true,
      })
      resolved = res.data
    } catch {
      throw new Error('ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง')
    }
    // keep showing the fire, now marked as resolved (status=true, booked=false)
    set({ reservedFire: resolved })
    get().loadFires() // fire status changed → refresh the map list
  },

  loadReservedFire: async () => {
    try {
      const res = await axios.get<Fire | null>(`${API_URL}/officers/me/fire`, { withCredentials: true })
      set({ reservedFire: res.data ?? null })
    } catch {}
  },
}))
