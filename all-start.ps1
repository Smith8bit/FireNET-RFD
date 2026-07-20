# Setup and start all FireNET components:
#   backend  -> postgres (docker) + FastAPI on 0.0.0.0:8000  (via backend\start.ps1)
#   web      -> Vite dev server (npm run dev)
#   mobile   -> Expo dev server (npx expo start), .env pointed at this machine's LAN IP
# Usage: .\all-start.ps1            (pass -Fresh to drop & recreate the database)
param([switch]$Fresh)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- detect the LAN IP (IPv4 of the interface holding the default route) ---
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric, ifMetric | Select-Object -First 1
if ($null -eq $route) { Write-Error "No default route found - is the network up?"; exit 1 }
$ip = (Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if (-not $ip) { Write-Error "Could not determine a network IP"; exit 1 }
Write-Host "Network IP: $ip" -ForegroundColor Cyan

# --- setup: backend venv + dependencies ---
if (-not (Test-Path "$root\backend\venv")) {
    Write-Host "Creating backend venv and installing requirements..." -ForegroundColor Yellow
    python -m venv "$root\backend\venv"
    if (-not $?) { Write-Error "venv creation failed"; exit 1 }
    & "$root\backend\venv\Scripts\python.exe" -m pip install -r "$root\backend\requirements.txt"
    if (-not $?) { Write-Error "pip install failed"; exit 1 }
}

# --- setup: web & mobile node_modules ---
foreach ($dir in 'web', 'mobile') {
    if (-not (Test-Path "$root\$dir\node_modules")) {
        Write-Host "Installing $dir dependencies..." -ForegroundColor Yellow
        Push-Location "$root\$dir"
        npm install
        $ok = $?
        Pop-Location
        if (-not $ok) { Write-Error "npm install failed in $dir"; exit 1 }
    }
}

# --- mobile: point the app at this machine's backend ---
Set-Content "$root\mobile\.env" "EXPO_PUBLIC_API_URL=http://${ip}:8000" -Encoding ascii
Write-Host "mobile\.env -> EXPO_PUBLIC_API_URL=http://${ip}:8000"

# --- start each component in its own window ---
$backendCmd = "& '$root\backend\start.ps1'"
if ($Fresh) { $backendCmd += " -Fresh" }
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\web'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\mobile'; npx expo start"

Write-Host ""
Write-Host "All components launching in separate windows:" -ForegroundColor Green
Write-Host "  backend : http://${ip}:8000  (liveness check: http://${ip}:8000/)"
Write-Host "  web     : http://localhost:5173"
Write-Host "  mobile  : Expo dev server (open in a dev build - Expo Go lacks this app's native modules)"
