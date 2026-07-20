<#
.SYNOPSIS
  Build and publish a signed Android release APK for FireNET's updater.

.DESCRIPTION
  One command takes a release end to end:

    1. Stamps VersionCode/VersionName into mobile/app.json AND
       mobile/android/app/build.gradle (both must agree — build.gradle is what
       actually reaches the APK, app.json is what a future prebuild regenerates
       it from).
    2. Runs gradlew assembleRelease to produce a signed APK.
    3. Verifies the APK's EMBEDDED versionCode/versionName match what was asked
       for, then copies it to backend/app_releases as
       firenet-<VersionName>-<VersionCode>.apk and writes android-latest.json,
       the manifest /app/android/latest serves to the mobile app.

  Step 3's verification is the point of this script. Publishing an APK whose
  embedded versionCode is lower than the manifest advertises produces an update
  prompt that reinstalls the same build and never clears, because the client
  compares the manifest against the version the installed APK reports.

  PREREQUISITES (the pipeline silently fails without them):
    1. The APK must be signed with the SAME production keystore as every prior
       release, or Android rejects the over-the-top install.
    2. VersionCode must be strictly greater than the currently installed build's,
       or Android refuses the install as a downgrade.

.EXAMPLE
  ./publish-apk.ps1 -VersionCode 2 -VersionName 1.0.1
  ./publish-apk.ps1 -VersionCode 3 -VersionName 1.2.0 -MinVersionCode 2 -ReleaseNotes "แก้ไขแผนที่ออฟไลน์"
  ./publish-apk.ps1 -VersionCode 2 -VersionName 1.0.1 -SkipBuild   # republish an existing APK
#>
[CmdletBinding()]
param(
  # versionCode of this build — stamped into the project and strictly increasing every release.
  [Parameter(Mandatory)][int]$VersionCode,
  # Human-readable versionName shown to the officer, e.g. "1.0.1".
  [Parameter(Mandatory)][string]$VersionName,
  # Builds below this versionCode are forced to update (mandatory). Defaults to 1 (never forced).
  [int]$MinVersionCode = 1,
  # Optional release notes surfaced by the client.
  [string]$ReleaseNotes = "",
  # Reuse the APK already at ApkPath instead of running Gradle. The embedded-version
  # check still runs, so a stale APK is rejected rather than published.
  [switch]$SkipBuild,
  # Regenerate the native android/ project from app.json before building.
  # Off by default: prebuild rewrites files under android/, and this repo checks
  # that directory in. Use it after changing plugins/permissions in app.json.
  [switch]$Prebuild,
  # Path to the signed release APK. Defaults to the standard Gradle output.
  [string]$ApkPath = "mobile/android/app/build/outputs/apk/release/app-release.apk",
  # Where the backend serves releases from (settings.APP_RELEASE_DIR).
  [string]$ReleaseDir = "backend/app_releases"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$apk = if ([IO.Path]::IsPathRooted($ApkPath)) { $ApkPath } else { Join-Path $root $ApkPath }
$dir = if ([IO.Path]::IsPathRooted($ReleaseDir)) { $ReleaseDir } else { Join-Path $root $ReleaseDir }
$mobile = Join-Path $root "mobile"
$appJson = Join-Path $mobile "app.json"
$gradleFile = Join-Path $mobile "android/app/build.gradle"

# ---------------------------------------------------------------- 1. stamp ---

# Text-level edits rather than ConvertFrom-Json/ConvertTo-Json: round-tripping
# app.json through PowerShell's JSON parser reformats and reorders the whole
# file, producing a large unreviewable diff for a two-value change.
function Set-FirstMatch {
  param([string]$Path, [string]$Pattern, [string]$Replacement, [string]$What)
  $text = [System.IO.File]::ReadAllText($Path)
  $re = [regex]::new($Pattern)
  if (-not $re.IsMatch($text)) { throw "Could not find $What in '$Path'. Update the pattern in publish-apk.ps1." }
  # Count 1: app.json's dependency block and build.gradle's dependency list both
  # contain other version-ish strings; only the first (the real declaration) is ours.
  [System.IO.File]::WriteAllText($Path, $re.Replace($text, $Replacement, 1))
}

Write-Host "Stamping $VersionName ($VersionCode) into the project..." -ForegroundColor Cyan
Set-FirstMatch $appJson '("version"\s*:\s*")[^"]*(")' "`${1}$VersionName`${2}" '"version"'
Set-FirstMatch $appJson '("versionCode"\s*:\s*)\d+' "`${1}$VersionCode" '"versionCode"'
Set-FirstMatch $gradleFile '(versionCode\s+)\d+' "`${1}$VersionCode" 'versionCode'
Set-FirstMatch $gradleFile '(versionName\s+")[^"]*(")' "`${1}$VersionName`${2}" 'versionName'

# ---------------------------------------------------------------- 2. build ---

if ($SkipBuild) {
  Write-Host "Skipping build (-SkipBuild); using existing APK." -ForegroundColor Yellow
} else {
  if ($Prebuild) {
    Write-Host "Running expo prebuild..." -ForegroundColor Cyan
    Push-Location $mobile
    try { & npx expo prebuild --platform android; if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed ($LASTEXITCODE)." } }
    finally { Pop-Location }
  }
  # Delete the previous output first: Gradle leaves the old APK in place if the
  # build fails, and copying that stale file would republish the wrong binary.
  if (Test-Path $apk) { Remove-Item $apk -Force }

  Write-Host "Building signed release APK (this takes a few minutes)..." -ForegroundColor Cyan
  Push-Location (Join-Path $mobile "android")
  try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease failed ($LASTEXITCODE)." }
  } finally { Pop-Location }
}

if (-not (Test-Path $apk)) { throw "APK not found at '$apk' after build." }

# --------------------------------------------------------------- 3. verify ---

# aapt2 ships per-build-tools-version; take the highest installed.
function Get-Aapt2 {
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
         elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
         else { Join-Path $env:LOCALAPPDATA "Android/Sdk" }
  $bt = Join-Path $sdk "build-tools"
  if (-not (Test-Path $bt)) { return $null }
  Get-ChildItem $bt -Directory |
    Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName "aapt2.exe" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
}

$aapt2 = Get-Aapt2
if (-not $aapt2) {
  Write-Host "WARNING: aapt2 not found — cannot verify the APK's embedded version." -ForegroundColor Yellow
  Write-Host "         Set ANDROID_HOME, or check by hand before trusting this release." -ForegroundColor Yellow
} else {
  # Capture fully before slicing: piping straight into Select-Object -First 1
  # tears down the pipeline early and leaves $LASTEXITCODE at -1, which looks
  # like a failure to anyone who later adds an exit-code check here.
  $badging = @(& $aapt2 dump badging $apk)
  $first = $badging | Select-Object -First 1
  $m = [regex]::Match($first, "versionCode='(\d+)'\s+versionName='([^']*)'")
  if (-not $m.Success) { throw "Could not read versionCode/versionName from '$apk'." }
  $realCode = [int]$m.Groups[1].Value
  $realName = $m.Groups[2].Value
  if ($realCode -ne $VersionCode -or $realName -ne $VersionName) {
    throw @"
APK version mismatch — refusing to publish.
  requested: versionCode $VersionCode, versionName $VersionName
  in the APK: versionCode $realCode, versionName $realName
The APK is stale (built before the stamp) or the build did not rerun. Delete
'$apk' and run again without -SkipBuild.
"@
  }
  Write-Host "Verified APK: versionCode $realCode, versionName $realName" -ForegroundColor Green
}

# -------------------------------------------------------------- 4. publish ---

if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

# Name carries the versionName as well as the code: this basename is what the
# backend serves as the download filename, so it is what the officer sees in
# their Downloads folder and file manager — "firenet-1.0.1-2.apk" is legible
# there in a way that a bare build number is not.
$destName = "firenet-$VersionName-$VersionCode.apk"
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

Write-Host ""
Write-Host "Published FireNET Android build:" -ForegroundColor Green
Write-Host "  versionCode : $VersionCode ($VersionName)"
Write-Host "  minSupported: $MinVersionCode"
Write-Host "  apk         : $dest ($([math]::Round($size / 1MB, 1)) MB)"
Write-Host "  manifest    : $manifestPath"
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  - Commit the version bump in mobile/app.json + mobile/android/app/build.gradle."
Write-Host "  - Upload $destName and android-latest.json to the server's app_releases/."
Write-Host "  - Ensure PUBLIC_BASE_URL is set in backend/.env."
