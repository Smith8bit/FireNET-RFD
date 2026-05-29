$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Start postgres if not already running
$running = docker ps --filter "name=tfms-postgres" --filter "status=running" -q
if (-not $running) {
    $exists = docker ps -a --filter "name=tfms-postgres" -q
    if ($exists) {
        docker start tfms-postgres
    } else {
        docker compose -f "$scriptDir\..\docker-compose.yml" up -d
    }
    # Wait for postgres to accept connections
    Write-Host "Waiting for postgres..."
    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        $check = docker exec tfms-postgres pg_isready -U tfms 2>&1
        if ($check -match "accepting connections") { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { Write-Error "Postgres did not become ready in time"; exit 1 }
    Write-Host "Postgres is ready."
}

.\venv\Scripts\Activate.ps1
fastapi dev
