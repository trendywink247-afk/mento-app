# Build only: never installs, clears an app, publishes an OTA, or signs for stores.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mobileRoot = Join-Path $repoRoot 'apps/mobile'
Push-Location $repoRoot
try {
    & git ls-files --error-unmatch scripts/local/android-acceptance.ps1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Commit the acceptance build script first' }
    $untrackedMobile = & git ls-files --others --exclude-standard -- apps/mobile
    if ($LASTEXITCODE -ne 0 -or $untrackedMobile) { throw 'Untracked mobile source prevents candidate attribution' }
    & git diff --quiet HEAD -- apps/mobile scripts/local/android-acceptance.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Commit the mobile candidate and build script before building' }
    $revision = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify source revision' }
    $output = Join-Path $repoRoot ".local/physical-acceptance/$revision"
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $env:MENTO_LOCAL_ACCEPTANCE = '1'
    $env:APP_VARIANT = 'development'
    $env:EXPO_NO_DOTENV = '1'
    $env:EXPO_PUBLIC_API_URL = 'http://localhost:18000/api/v1'
    $env:EXPO_PUBLIC_OWN_CHAT_ACCEPTED = '1'
    $env:EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED = '1'
    $env:EXPO_PUBLIC_STREAM_API_KEY = ''
    $env:EXPO_PUBLIC_POSTHOG_KEY = ''
    $env:EXPO_PUBLIC_SENTRY_DSN = ''
    $env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
    Remove-Item Env:EAS_BUILD_PROFILE -ErrorAction SilentlyContinue
    Set-Location $mobileRoot
    $resolved = & node node_modules/expo/bin/cli config --type public --json
    if ($LASTEXITCODE -ne 0) { throw 'Expo config failed' }
    $config = $resolved | ConvertFrom-Json
    if ($config.android.package -ne 'com.mento.acceptance' -or $config.updates.enabled -ne $false -or
        $config.updates.url -or $config.android.googleServicesFile -or $config.extra.eas) {
        throw 'Refusing configuration outside the separate offline acceptance app'
    }
    $resolved | Set-Content -LiteralPath (Join-Path $output 'resolved-config.json') -Encoding utf8
    & node node_modules/expo/bin/cli prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Android prebuild failed' }
    Set-Location (Join-Path $mobileRoot 'android')
    # Explicit JVM limits and one ABI bound workstation cost; generated files only.
    & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m' --max-workers=2 --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance APK build failed' }
    $apk = Join-Path (Get-Location).Path 'app/build/outputs/apk/release/app-release.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Built APK absent' }
    $destination = Join-Path $output 'mento-acceptance.apk'
    Copy-Item -LiteralPath $apk -Destination $destination
    [ordered]@{
        revision = $revision
        application_id = 'com.mento.acceptance'
        api_origin = 'http://localhost:18000/api/v1'
        apk_sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        architecture = 'arm64-v8a'
        purpose = 'synthetic-local-acceptance-never-promote'
        signing = 'generated-development-key; verify certificate before installation'
        embedded_manifest_verified = $false
        device_acceptance = 'pending'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'candidate.json') -Encoding utf8
    Write-Output "Built local acceptance APK: $destination"
    Write-Output 'Inspect embedded manifest, API bundle and signing certificate before installation.'
} finally { Pop-Location }
