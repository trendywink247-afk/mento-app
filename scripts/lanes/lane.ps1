# Creates one isolated "lane" for a port agent: its own worktree, database, Redis index, API port and Expo web port.
#   pwsh -File lane.ps1 -Name u2 -N 2 -Base feat/board-port
param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][int]$N, [string]$Base = "feat/board-port")
$ErrorActionPreference = "Stop"
$repo = "C:\Users\khana\Desktop\Mento"
$lane = "C:\ml\$Name"                     # short path on purpose (Windows MAX_PATH bites inside node_modules)
$db = "mento_$Name"; $apiPort = 8000 + $N; $webPort = 8081 + $N; $redisDb = 1 + $N
New-Item -ItemType Directory -Force C:\ml | Out-Null

if (-not (Test-Path $lane)) {
    git -C $repo worktree add $lane -b "feat/port-$Name" $Base | Out-Null
}
Copy-Item "$repo\services\api\.env" "$lane\services\api\.env" -Force
foreach ($f in ".env", ".env.production", ".npmrc") { if (Test-Path "$repo\apps\mobile\$f") { Copy-Item "$repo\apps\mobile\$f" "$lane\apps\mobile\$f" -Force } }

# database: create, migrate, seed mentors
$exists = docker exec mento-postgres psql -U mento -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='$db';"
if (-not $exists) { docker exec mento-postgres psql -U mento -d postgres -c "CREATE DATABASE $db OWNER mento;" | Out-Null }
$env:DATABASE_URL = "postgresql+psycopg://mento:mento@localhost:5432/$db"
$env:REDIS_URL = "redis://localhost:6379/$redisDb"
$env:APP_BASE_URL = "http://localhost:$webPort"; $env:ADMIN_BASE_URL = "http://localhost:$webPort"; $env:CONSOLE_BASE_URL = "http://localhost:$webPort"
$py = "$repo\services\api\.venv\Scripts\python.exe"
Push-Location "$lane\services\api"
& $py -m alembic upgrade head 2>&1 | Select-Object -Last 1
& $py -m scripts.seed_listeners 2>&1 | Select-Object -Last 1
Pop-Location

# node_modules: a real install (junctions confuse Metro on Windows); postinstall applies the patches
if (-not (Test-Path "$lane\apps\mobile\node_modules\expo\package.json")) {
    Push-Location "$lane\apps\mobile"; npm install --no-audit --no-fund 2>&1 | Select-Object -Last 2; Pop-Location
}

# servers, detached so they outlive this shell; logs in the lane
Start-Process -WindowStyle Hidden -WorkingDirectory "$lane\services\api" -FilePath $py `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "$apiPort" `
    -RedirectStandardOutput "$lane\api.out.log" -RedirectStandardError "$lane\api.err.log"
$env:EXPO_PUBLIC_API_URL = "http://localhost:$apiPort/api/v1"
Remove-Item Env:CI -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -WorkingDirectory "$lane\apps\mobile" -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx expo start --web --port $webPort > `"$lane\expo.log`" 2>&1"
"lane $Name ready: worktree $lane | branch feat/port-$Name | db $db | redis $redisDb | api :$apiPort | web :$webPort"
