// Self-hosted Android in-app update pipeline (sideloaded APK — no Play Store,
// no expo-updates / OTA). The app reads its own native versionCode, asks the
// backend for the latest published build, and — on the officer's tap —
// downloads the signed APK and hands it to Android's package installer.
//
// The install itself is NOT silent: Android shows an "Update" confirmation the
// officer must tap, plus a one-time "allow installs from FireNET" grant on
// first use. Every published APK MUST be signed with the same key as the
// installed build, or Android refuses the over-the-top install. See the
// backend `/app/android/latest` manifest endpoint for the server side.
import { api } from '@/lib/api'
import * as Application from 'expo-application'
import { File, Paths } from 'expo-file-system'
import * as IntentLauncher from 'expo-intent-launcher'
import { Platform } from 'react-native'

/** Shape of the JSON the backend serves at `/api/app/android/latest`. */
export type UpdateManifest = {
  /** versionCode of the newest published build. */
  latestVersionCode: number
  /** Human-readable versionName of that build, e.g. "1.1.0". */
  latestVersionName: string
  /** Builds below this versionCode must update before continuing. */
  minSupportedVersionCode: number
  /** Absolute URL of the signed APK (served static by nginx under /firenet). */
  apkUrl: string
  /** Size in bytes, for a download label / sanity check. */
  fileSize: number
  /** Optional release notes to show the officer. */
  releaseNotes?: string
}

export type UpdateStatus =
  | { kind: 'up-to-date' }
  | { kind: 'optional'; manifest: UpdateManifest }
  | { kind: 'mandatory'; manifest: UpdateManifest }

/**
 * This build's Android versionCode. `Application.nativeBuildVersion` is the
 * versionCode on Android (a string, e.g. "2"); returns 0 on iOS or when
 * unavailable so callers can treat non-Android as always up to date.
 */
export function currentVersionCode(): number {
  if (Platform.OS !== 'android') return 0
  return Number(Application.nativeBuildVersion ?? 0)
}

/** This build's versionName (e.g. "1.0.0") for display; "—" if unavailable. */
export function currentVersionName(): string {
  return Application.nativeApplicationVersion ?? '—'
}

/**
 * Asks the backend for the newest published Android build and compares it to
 * this install. Uses the shared axios client so the officer's bearer token is
 * attached automatically. Fails open (returns 'up-to-date') on any network or
 * permission error so a flaky connection never blocks the Settings screen.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (Platform.OS !== 'android') return { kind: 'up-to-date' }
  try {
    const { data } = await api.get<UpdateManifest>('/app/android/latest')
    const cur = currentVersionCode()
    if (cur >= data.latestVersionCode) return { kind: 'up-to-date' }
    if (cur < data.minSupportedVersionCode) return { kind: 'mandatory', manifest: data }
    return { kind: 'optional', manifest: data }
  } catch {
    return { kind: 'up-to-date' }
  }
}

/**
 * Downloads the APK to the cache dir with progress, then launches Android's
 * package installer via an ACTION_VIEW intent.
 *
 * @param manifest - the target build from `checkForUpdate()`.
 * @param onProgress - download fraction 0..1, for a progress label.
 * @throws if the download fails or the installer can't be launched.
 */
export async function downloadAndInstall(
  manifest: UpdateManifest,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const dest = new File(Paths.cache, `firenet-${manifest.latestVersionCode}.apk`)
  // `createDownloadTask` has no idempotent flag and a failed download can leave
  // a partial file behind, so clear any stale/partial file before starting.
  if (dest.exists) dest.delete()

  const task = File.createDownloadTask(manifest.apkUrl, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes)
    },
  })
  const file = await task.downloadAsync()
  if (!file) throw new Error('download did not complete')

  // ACTION_VIEW + the package-archive MIME type is the most broadly compatible
  // install trigger. flags:1 = FLAG_GRANT_READ_URI_PERMISSION so the installer
  // can read our content:// URI (backed by expo-file-system's FileProvider).
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1,
  })
}
