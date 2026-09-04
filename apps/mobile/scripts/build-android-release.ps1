# Builds a production-pointed release APK without ever touching apps/mobile/.env.
#
# Sets NODE_ENV=production for this process only, which makes Expo's built-in
# @expo/env loader merge .env.production over .env (see ANDROID_BUILD.md §8f) and
# makes babel-preset-expo inline the resulting EXPO_PUBLIC_* values into the bundle.
# The dev .env file is never read for a prod build and is never edited by this script.
#
# Requires apps/mobile/.env.production to exist first (gitignored, prod values only —
# see .env.example for the shape). Run from apps/mobile, or anywhere (path-safe).
#
# Usage: powershell -File scripts/build-android-release.ps1

$ErrorActionPreference = "Stop"

$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location $mobileRoot

if (-not (Test-Path ".env.production")) {
    Write-Error ".env.production not found in $mobileRoot — create it first (prod EXPO_PUBLIC_* values, gitignored). See .env.example for the shape."
    exit 1
}

Write-Host "== Building release APK against .env.production (NODE_ENV=production) ==" -ForegroundColor Cyan

$env:NODE_ENV = "production"

npx expo prebuild --platform android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location "android"
try {
    ./gradlew assembleRelease
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Set-Location $mobileRoot
}

Write-Host "== Done: android/app/build/outputs/apk/release/app-release.apk ==" -ForegroundColor Green
Write-Host "Verify the URL actually inlined (ANDROID_BUILD.md §8f):" -ForegroundColor Yellow
Write-Host '  Select-String -Path android\app\build\generated\assets\createBundleReleaseJsAndAssets\index.android.bundle -Pattern "api.agentin.chat"'
