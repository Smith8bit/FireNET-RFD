// Global store for a field officer's fire-incident workflow: the list of
// active fires, their current reservation (the one fire they're assigned to
// respond to), and their online/on-duty status. Persisted via AsyncStorage
// so the fire list is visible immediately on relaunch, before the network
// round-trip in loadFires() completes.
import AsyncStorage from '@react-native-async-storage/async-storage'
import axios from 'axios'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { api } from '@/lib/api'

/** A single evidence attachment captured when resolving a fire. */
export type ResolvePhoto = {
  uri: string
  gps: { latitude: number; longitude: number } | null
  kind?: 'image' | 'video'
  thumbUri?: string
}

/** A wildfire/incident record as synced from the backend. */
export type Fire = {
  id: string
  name: string
  lat: number
  lng: number
  status: boolean
  expired?: boolean
  false_alarm?: boolean
  booked: boolean
  appointed?: boolean
  detected_at: string
  tumboon: string | null
  aumper: string | null
  province: string | null
  type: string | null
  satellite: string | null
}

type FireState = {
  fires: Fire[]
  selectedFireId: string | null
  reservedFire: Fire | null
  /** True while a fetch from `loadFires` is in flight; guards against overlapping calls. */
  loading: boolean
  /** Whether this officer is currently on-duty/visible for dispatch. */
  online: boolean
  /** Refetches the active fire list; no-op if a load is already in progress. */
  loadFires: () => Promise<void>
  selectFire: (id: string | null) => void
  /**
   * Claims a fire for this officer to respond to.
   * @throws localized Error for known failure reasons: outside jurisdiction,
   * already holding another unresolved fire, offline, or already claimed by
   * someone else.
   */
  reserveFire: (fire: Fire) => Promise<void>
  /**
   * Releases this officer's current reservation.
   * @throws localized Error if the fire was assigned by an admin (only the
   * admin can release those).
   */
  cancelReservation: () => Promise<void>
  /**
   * Submits resolution evidence for the reserved fire and clears the reservation.
   * @param note - optional free-text note; omitted from the request if blank.
   * @param photos - captured evidence; each may be a photo or video, with
   * optional GPS metadata per item.
   * @throws localized Error if the officer went offline before resolving.
   */
  resolveFire: (note: string, photos: ResolvePhoto[]) => Promise<void>
  /** Reports the reserved fire as a false alarm and clears the reservation. */
  reportFalseFire: (note: string) => Promise<void>
  /** Refreshes `reservedFire` from the server; silently no-ops on failure (keeps stale/persisted value). */
  loadReservedFire: () => Promise<void>
  /** Refreshes `online` from the server; silently no-ops on failure. */
  loadStatus: () => Promise<void>
  /**
   * Toggles on-duty status, optionally reporting a location alongside it.
   * @throws localized Error on failure.
   */
  setOnline: (online: boolean, coords?: { latitude: number; longitude: number }) => Promise<void>
  /** Best-effort location ping while online; failures are swallowed so a single dropped update doesn't interrupt tracking. */
  pushLocation: (coords: { latitude: number; longitude: number }) => Promise<void>
}

export const useFireStore = create<FireState>()(
  // `persist` writes state to AsyncStorage on every change and rehydrates it
  // on startup — see `partialize` below for exactly which fields survive.
  persist(
    (set, get) => ({
  fires: [],
  selectedFireId: null,
  reservedFire: null,
  loading: false,
  online: false,

  loadFires: async () => {
    if (get().loading) return // avoid duplicate concurrent requests (e.g. pull-to-refresh racing a poll)
    set({ loading: true })
    try {
      const res = await api.get<Fire[]>('/fires')
      set({ fires: res.data })
    } catch {
      // Leave the previous (possibly persisted/stale) fire list in place on failure.
    } finally {
      set({ loading: false })
    }
  },

  selectFire: (id) => set({ selectedFireId: id }),

  reserveFire: async (fire) => {
    try {
      // Server may return an updated fire record (e.g. server-computed
      // fields); fall back to the optimistic local `fire` if it returns none.
      const res = await api.patch<Fire | null>('/officers/me/fire', { fire_id: fire.id })
      set({ reservedFire: res.data ?? fire })
      get().loadFires() // refresh the list so the claimed fire's booked status is reflected everywhere
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 403) {
        throw new Error('ไฟนี้อยู่นอกพื้นที่รับผิดชอบของคุณ') // "This fire is outside your jurisdiction"
      }
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        // 409 covers several distinct conflict reasons distinguished by `detail`.
        const detail = (e.response.data as { detail?: string } | undefined)?.detail
        if (detail === 'officer already holds an unresolved fire') {
          throw new Error('คุณมีไฟที่จองอยู่แล้ว ต้องดับไฟเดิมก่อนจึงจะจองจุดใหม่ได้') // must resolve current fire first
        }
        if (detail === 'officer offline') {
          throw new Error('คุณต้องออนไลน์ก่อนจึงจะจองได้') // must be online to reserve
        }
        throw new Error('ไฟนี้ถูกเจ้าหน้าที่ท่านอื่นจองแล้ว') // fire already claimed by another officer
      }
      throw new Error('ไม่สามารถจองไฟนี้ได้ กรุณาลองใหม่อีกครั้ง') // generic fallback
    }
  },

  cancelReservation: async () => {
    try {
      await api.patch('/officers/me/fire', { fire_id: null })
      set({ reservedFire: null })
      get().loadFires()
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 403) {
        // Admin-assigned appointments can only be released by the admin, not self-cancelled.
        throw new Error('ไฟนี้ผู้ดูแลเป็นผู้มอบหมาย ต้องให้ผู้ดูแลยกเลิกเท่านั้น')
      }
      throw new Error('ไม่สามารถยกเลิกการจองได้ กรุณาลองใหม่อีกครั้ง')
    }
  },

  resolveFire: async (note, photos) => {
    const form = new FormData()
    if (note.trim()) form.append('note', note.trim())
    // GPS coordinates are sent as a parallel JSON array (rather than per-file
    // metadata) because multipart fields can't carry structured data directly;
    // array order must match the `images` append order below for the backend
    // to associate each GPS entry with its file.
    form.append('image_gps', JSON.stringify(photos.map((p) => p.gps)))
    photos.forEach((p, i) => {
      const video = p.kind === 'video'
      form.append('images', {
        uri: p.uri,
        name: video ? `evidence-${i}.mp4` : `photo-${i}.jpg`,
        type: video ? 'video/mp4' : 'image/jpeg',
      } as any)
    })
    try {
      await api.post<Fire>('/officers/me/fire/resolve', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000, // generous timeout for uploading multiple photos/videos over slow field connections
      })
    } catch (e) {
      if (
        axios.isAxiosError(e) &&
        e.response?.status === 409 &&
        (e.response.data as { detail?: string } | undefined)?.detail === 'officer offline'
      ) {
        throw new Error('คุณต้องออนไลน์ก่อนจึงจะบันทึกการดับไฟได้') // must be online to submit resolution
      }
      throw new Error('ไม่สามารถบันทึกการดับไฟได้ กรุณาลองใหม่อีกครั้ง')
    }
    set({ reservedFire: null })
    get().loadFires()
  },

  reportFalseFire: async (note) => {
    try {
      await api.post<Fire>('/officers/me/fire/false-report', {
        note: note.trim() || undefined,
      })
    } catch (e) {
      if (
        axios.isAxiosError(e) &&
        e.response?.status === 409 &&
        (e.response.data as { detail?: string } | undefined)?.detail === 'officer offline'
      ) {
        throw new Error('คุณต้องออนไลน์ก่อนจึงจะรายงานได้') // must be online to file a false-alarm report
      }
      throw new Error('ไม่สามารถรายงานว่าไม่ใช่ไฟได้ กรุณาลองใหม่อีกครั้ง')
    }
    set({ reservedFire: null })
    get().loadFires()
  },

  setOnline: async (online, coords) => {
    try {
      // Location endpoint doubles as the duty-status toggle: `active` marks
      // on/off duty, and coords (if provided) update the last-known position
      // in the same request.
      await api.patch('/officers/me/location', { ...coords, active: online })
      set({ online })
    } catch {
      throw new Error('ไม่สามารถเปลี่ยนสถานะได้ กรุณาลองใหม่อีกครั้ง')
    }
  },

  pushLocation: async (coords) => {
    try {
      await api.patch('/officers/me/location', coords)
    } catch {
      // Silently dropped: this is called on a recurring foreground timer, so
      // a single failed ping is superseded by the next one.
    }
  },

  loadReservedFire: async () => {
    try {
      const res = await api.get<Fire | null>('/officers/me/fire')
      set({ reservedFire: res.data ?? null })
    } catch {}
  },

  loadStatus: async () => {
    try {
      const res = await api.get<{ active: boolean }>('/officers/me/status')
      set({ online: res.data.active })
    } catch {}
  },
    }),
    {
      name: 'firenet-fire-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only fires/reservedFire survive relaunch — `loading`, `online`, and
      // `selectedFireId` are transient/session state that should always
      // start fresh (e.g. an officer shouldn't reopen the app appearing
      // "online" without having actually re-established that with the server).
      partialize: (s) => ({ fires: s.fires, reservedFire: s.reservedFire }),
    },
  ),
)
