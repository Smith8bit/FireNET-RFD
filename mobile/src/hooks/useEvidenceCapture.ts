import { toast } from '@/lib/toastStore'
import { type ResolvePhoto } from '@/stores/fireStore'
import { File } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { useCallback, useRef, useState } from 'react'
import { Video } from 'react-native-compressor'

export const EVIDENCE_MAX_PHOTOS = 3
const VIDEO_MAX_MB = 40

function gpsFromExif(exif: Record<string, any> | null | undefined): ResolvePhoto['gps'] {
  if (!exif) return null
  let lat = exif.GPSLatitude
  let lng = exif.GPSLongitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (exif.GPSLatitudeRef === 'S' && lat > 0) lat = -lat
  if (exif.GPSLongitudeRef === 'W' && lng > 0) lng = -lng
  return { latitude: lat, longitude: lng }
}

export function useEvidenceCapture() {
  const [photos, setPhotos] = useState<ResolvePhoto[]>([])
  const [video, setVideo] = useState<ResolvePhoto | null>(null)
  const [compressingVideo, setCompressingVideo] = useState(false)
  const deviceGps = useRef<ResolvePhoto['gps']>(null)

  const reset = useCallback(() => {
    setPhotos([])
    setVideo(null)
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((pos) => {
        deviceGps.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      })
      .catch(() => {
        deviceGps.current = null
      })
  }, [])

  const addAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    const gps = gpsFromExif(asset.exif) ?? deviceGps.current
    const small = await manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
    })
    setPhotos((prev) => (prev.length >= EVIDENCE_MAX_PHOTOS ? prev : [...prev, { uri: small.uri, gps }]))
  }, [])

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปใช้กล้อง')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const removePhoto = useCallback((uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri))
  }, [])

  const removeVideo = useCallback(() => setVideo(null), [])

  const captureVideo = useCallback(
    async (fromLibrary: boolean) => {
      const perm = fromLibrary
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync()
      if (perm.status !== 'granted') {
        toast.error(fromLibrary ? 'กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ' : 'กรุณาอนุญาตให้แอปใช้กล้อง')
        return
      }
      const opts = { mediaTypes: 'videos' as const }
      const result = fromLibrary
        ? await ImagePicker.launchImageLibraryAsync(opts)
        : await ImagePicker.launchCameraAsync(opts)
      if (result.canceled || !result.assets[0]) return
      setCompressingVideo(true)
      try {
        const compressed = await Video.compress(result.assets[0].uri, { compressionMethod: 'manual', maxSize: 1280 })
        if (new File(compressed).size > VIDEO_MAX_MB * 1024 * 1024) {
          toast.error(`วิดีโอใหญ่เกินไป (สูงสุด ${VIDEO_MAX_MB}MB) กรุณาถ่ายให้สั้นลง`)
          return
        }
        const thumb = await VideoThumbnails.getThumbnailAsync(compressed).catch(() => null)
        setVideo({ uri: compressed, gps: deviceGps.current, kind: 'video', thumbUri: thumb?.uri })
      } catch {
        toast.error('ไม่สามารถประมวลผลวิดีโอได้ กรุณาลองใหม่อีกครั้ง')
      } finally {
        setCompressingVideo(false)
      }
    },
    [],
  )

  return {
    photos,
    video,
    compressingVideo,
    reset,
    takePhoto,
    pickPhoto,
    removePhoto,
    removeVideo,
    captureVideo,
  }
}

export type EvidenceCapture = ReturnType<typeof useEvidenceCapture>
