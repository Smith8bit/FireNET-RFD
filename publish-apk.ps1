<#
.SYNOPSIS
  Publish a signed Android release APK for FireNET's in-app updater.

.DESCRIPTION
  Copies a built, SIGNED release APK into the backend's app_releases directory as
  firenet-<VersionCode>.apk and (re)writes android-latest.json, the manifest the
  /app/android/latest endpoint serves to the mobile app. After this runs and the
  backend has the updated files, field officers see the new build in Settings.

  PREREQUISITES (the pipeline silently fails without them):
    1. The APK must be signed with the SAME production keystore as every prior
       release, or Android rejects the over-the-top install.
    2. VersionCode must be strictly greater than the currently installed build's,
       or Android refuses the install as a downgrade.

.EXAMPLE
  ./publish-apk.ps1 -VersionCode 2 -VersionName 1.1.0
  ./publish-apk.ps1 -VersionCode 3 -VersionName 1.2.0 -MinVersionCode 2 -ReleaseNotes "แก้ไขแผนที่ออฟไลน์"
#>
[CmdletBinding()]
param(
  # versionCode of this build — must match android/app/build.gradle and increase every release.
  [Parameter(Mandatory)][int]$VersionCode,
  # Human-readable versionName shown to the officer, e.g. "1.1.0".
  [Parameter(Mandatory)][string]$VersionName,
  # Builds below this versionCode are forced to update (mandatory). Defaults to 1 (never forced).
  [int]$MinVersionCode = 1,
  # Optional release notes surfaced by the client.
  [string]$ReleaseNotes = "",
  # Path to the signed release APK. Defaults to the standard Gradle output.
  [string]$ApkPath = "mobile/android/app/build/outputs/apk/release/app-release.apk",
  # Where the backend serves releases from (settings.APP_RELEASE_DIR).
  [string]$ReleaseDir = "backend/app_releases"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$apk = if ([IO.Path]::IsPathRooted($ApkPath)) { $ApkPath } else { Join-Path $root $ApkPath }
$dir = if ([IO.Path]::IsPathRooted($ReleaseDir)) { $ReleaseDir } else { Join-Path $root $ReleaseDir }

if (-not (Test-Path $apk)) {
  throw "APK not found at '$apk'. Build a SIGNED release first (e.g. cd mobile/android; ./gradlew assembleRelease)."
}
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$destName = "firenet-$VersionCode.apk"
$dest = Join-Path $dir $destName
Copy-Item $apk $dest -Force
$size = (Get-Item $dest).Length

# Build the manifest object the mobile app expects. apkUrl is added by the
# backend at request time from PUBLIC_BASE_URL, so it is intentionally omitted here.
$manifest = [ordered]@{
  latestVersionCode       = $VersionCode
  latestVersionName       = $VersionName
  minSupportedVersionCode = $MinVersionCode
  fileSize                = $size
  releaseNotes            = $ReleaseNotes
}
$json = $manifest | ConvertTo-Json

# Write UTF-8 WITHOUT a BOM. Windows PowerShell's Set-Content -Encoding utf8 adds
# a BOM; the .NET writer below avoids it (the backend also reads utf-8-sig as a guard).
$manifestPath = Join-Path $dir "android-latest.json"
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Published FireNET Android build:" -ForegroundColor Green
Write-Host "  versionCode : $VersionCode ($VersionName)"
Write-Host "  minSupported: $MinVersionCode"
Write-Host "  apk         : $dest ($([math]::Round($size / 1MB, 1)) MB)"
Write-Host "  manifest    : $manifestPath"
Write-Host ""
Write-Host "Reminders:" -ForegroundColor Yellow
Write-Host "  - APK must be signed with the production keystore (not the debug key)."
Write-Host "  - Deploy $dir to the backend host and ensure PUBLIC_BASE_URL is set in backend/.env."
