// Self-hosted Android update pipeline (sideloaded APK — no Play Store, no
// expo-updates / OTA). The app reads its own native versionCode, asks the
// backend for the latest published build, and — on the officer's tap — hands
// the APK URL to the system browser.
//
// The download and the install both happen OUTSIDE the app: Chrome (or whatever
// browser handles the link) downloads the APK, and the officer opens it from
// Downloads / their file manager to install. That app, not FireNET, is the one
// Android asks for the "allow installs from this source" grant. Every published
// APK MUST be signed with the same key as the installed build, or Android
// refuses the over-the-top install. See the backend `/app/android/latest`
// manifest endpoint for the server side.
import { api } from '@/lib/api'
import * as Application from 'expo-application'
import { Linking, Platform } from 'react-native'

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
 * Hands the APK URL to the system browser, which downloads it to the device's
 * Downloads folder. The officer then opens that file themselves — from Chrome's
 * download notification or their file manager — to run the install.
 *
 * Returns as soon as the browser has been launched; the download continues in
 * the browser and the app has no visibility into its progress or outcome.
 *
 * @param manifest - the target build from `checkForUpdate()`.
 * @throws if no app on the device can open the URL.
 */
export async function openApkDownload(manifest: UpdateManifest): Promise<void> {
  await Linking.openURL(manifest.apkUrl)
}
