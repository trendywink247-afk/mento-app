param(
    [ValidateSet('init', 'api', 'worker', 'web', 'check', 'test', 'status', 'stop-infra')]
    [string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = Join-Path $repoRoot 'services/api/.venv/Scripts/python.exe'
$launcher = Join-Path $PSScriptRoot 'api.py'
$compose = Join-Path $repoRoot 'deploy/compose.workspace.yml'
Push-Location $repoRoot
try {
    switch ($Action) {
        'init' {
            & docker compose -f $compose up -d --wait
            if ($LASTEXITCODE -ne 0) { throw 'Workspace infrastructure failed' }
            & $python $launcher init
        }
        'api' { & $python $launcher serve }
        'worker' { & $python $launcher worker }
        'check' { & $python $launcher check }
        'test' { & $python $launcher test }
        'web' {
            # Expo must not pick up copied production/LAN .env files.
            $env:EXPO_NO_DOTENV = '1'
            $env:EXPO_PUBLIC_API_URL = 'http://localhost:18000/api/v1'
            $env:EXPO_PUBLIC_STREAM_API_KEY = ''
            $streamFile = Join-Path $repoRoot '.local/stream.env'
            if (Test-Path $streamFile) {
                $keyLine = Get-Content $streamFile | Where-Object { $_ -match '^STREAM_API_KEY=' } | Select-Object -First 1
                if (-not $keyLine) { throw 'Dedicated local Stream config missing API key' }
                $env:EXPO_PUBLIC_STREAM_API_KEY = $keyLine.Substring('STREAM_API_KEY='.Length)
            }
            $env:EXPO_PUBLIC_POSTHOG_KEY = ''
            $env:EXPO_PUBLIC_SENTRY_DSN = ''
            $env:APP_VARIANT = 'development'
            Remove-Item Env:CI -ErrorAction SilentlyContinue
            Set-Location (Join-Path $repoRoot 'apps/mobile')
            & node node_modules/expo/bin/cli start --web --port 18081 --localhost
        }
        'status' {
            & docker compose -f $compose ps
            if ($LASTEXITCODE -ne 0) { throw 'Docker status failed' }
            $unavailable = $false
            foreach ($url in @('http://localhost:18000/api/v1/health/ready', 'http://localhost:18081')) {
                try { "$url -> $((Invoke-WebRequest $url -TimeoutSec 8).StatusCode)" }
                catch { "$url -> unavailable"; $unavailable = $true }
            }
            if ($unavailable) { throw 'One or more workspace services are unavailable' }
        }
        'stop-infra' { & docker compose -f $compose stop }
    }
    if ($LASTEXITCODE -ne 0) { throw "Workspace action failed: $Action (exit $LASTEXITCODE)" }
} finally { Pop-Location }
