// Encapsulates the photo/video evidence capture flow used when an officer
// resolves a fire (see stores/fireStore.ts's resolveFire, which consumes
// ResolvePhoto[]). Bundles camera/library permission handling, image
// downscaling, video compression + size enforcement, and GPS tagging behind
// a single hook so the resolve-fire UI doesn't need to know these details.
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
const VIDEO_MAX_MB = 40 // upload/storage cap enforced client-side after compression

/**
 * Extracts GPS coordinates from a photo's EXIF metadata.
 * @param exif - raw EXIF dictionary from ImagePicker (shape varies by
 * platform/device and isn't strongly typed upstream, hence `Record<string, any>`).
 * @returns coordinates, or null if EXIF is missing or has no valid GPS fields.
 * EXIF stores latitude/longitude as unsigned magnitudes with separate
 * hemisphere reference letters, so South/West values must be negated manually
 * to get signed decimal degrees.
 */
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
  // Fallback GPS for assets whose EXIF has no location (common for videos,
  // and for photos on devices/cameras with location tagging disabled). A ref
  // (not state) since it's fetched once per session and only read, never rendered.
  const deviceGps = useRef<ResolvePhoto['gps']>(null)

  /**
   * Clears any previously captured evidence and kicks off a fresh device
   * location fetch for use as the GPS fallback. Call this when starting a
   * new capture session (e.g. opening the resolve-fire flow) rather than on
   * every photo, so a burst of photos shares one location fix instead of
   * requesting one per shot.
   */
  const reset = useCallback(() => {
    setPhotos([])
    setVideo(null)
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((pos) => {
        deviceGps.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      })
      .catch(() => {
        // Location unavailable/denied — photos will simply have gps: null
        // unless their own EXIF supplies it.
        deviceGps.current = null
      })
  }, [])

  /**
   * Downscales a captured/picked image and appends it to `photos`.
   * @param asset - result from an ImagePicker camera/library call.
   * Resized to 1600px wide / 0.8 JPEG quality to bound upload size for the
   * multipart submission in fireStore's resolveFire, while staying legible
   * as fire-damage evidence. Silently drops the asset once
   * EVIDENCE_MAX_PHOTOS is reached rather than erroring, since the calling
   * UI is expected to disable capture actions at the limit.
   */
  const addAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    const gps = gpsFromExif(asset.exif) ?? deviceGps.current
    const small = await manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
    })
    setPhotos((prev) => (prev.length >= EVIDENCE_MAX_PHOTOS ? prev : [...prev, { uri: small.uri, gps }]))
  }, [])

  /** Captures a photo via the camera, after requesting camera permission. */
  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปใช้กล้อง') // "Please allow the app to use the camera"
      return
    }
    // exif: true is required to read GPS tags in gpsFromExif above.
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  /** Picks a photo from the device's media library, after requesting access. */
  const pickPhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      toast.error('กรุณาอนุญาตให้แอปเข้าถึงคลังภาพ') // "Please allow the app to access the photo library"
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: true })
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0])
  }, [addAsset])

  const removePhoto = useCallback((uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri))
  }, [])

  const removeVideo = useCallback(() => setVideo(null), [])

  /**
   * Captures or picks a video, compresses it, and enforces a size cap.
   * @param fromLibrary - true to pick an existing video, false to record a
   * new one; determines both which permission is requested and which
   * ImagePicker entry point is launched.
   * Only one video is kept at a time (unlike photos), reflecting the resolve
   * form's single-video-attachment UI. Compression always runs before the
   * size check because `Video.compress`'s `maxSize` targets resolution, not
   * file size, so the result can still exceed VIDEO_MAX_MB and must be
   * rejected explicitly. Thumbnail generation is best-effort (`catch(() =>
   * null)`) since a missing thumbnail shouldn't block attaching the video.
   */
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
      setCompressingVideo(true) // drives a loading state in the UI while compression (potentially slow) runs
      try {
        const compressed = await Video.compress(result.assets[0].uri, { compressionMethod: 'manual', maxSize: 1280 })
        if (new File(compressed).size > VIDEO_MAX_MB * 1024 * 1024) {
          toast.error(`วิดีโอใหญ่เกินไป (สูงสุด ${VIDEO_MAX_MB}MB) กรุณาถ่ายให้สั้นลง`) // "Video too large, please record a shorter one"
          return
        }
        const thumb = await VideoThumbnails.getThumbnailAsync(compressed).catch(() => null)
        setVideo({ uri: compressed, gps: deviceGps.current, kind: 'video', thumbUri: thumb?.uri })
      } catch {
        toast.error('ไม่สามารถประมวลผลวิดีโอได้ กรุณาลองใหม่อีกครั้ง') // "Could not process the video, please try again"
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

/** Return type of {@link useEvidenceCapture}, for typing props/context that pass the hook's API down. */
export type EvidenceCapture = ReturnType<typeof useEvidenceCapture>
