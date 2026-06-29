param([switch]$Fresh)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Start postgres if not already running
$running = docker ps --filter "name=firenet-postgres" --filter "status=running" -q
if (-not $running) {
    $exists = docker ps -a --filter "name=firenet-postgres" -q
    if ($exists) {
        docker start firenet-postgres
    } else {
        docker compose -f "$scriptDir\..\docker-compose.yml" up -d
    }
    # Wait for postgres to accept connections
    Write-Host "Waiting for postgres..."
    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        $check = docker exec firenet-postgres pg_isready -U firenet 2>&1
        if ($check -match "accepting connections") { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { Write-Error "Postgres did not become ready in time"; exit 1 }
    Write-Host "Postgres is ready."
}

# Drop & recreate the database for a clean run: .\start.ps1 -Fresh
if ($Fresh) {
    Write-Host "Resetting database (dropping and recreating 'firenet')..."
    docker exec firenet-postgres psql -U firenet -d postgres -c "DROP DATABASE IF EXISTS firenet WITH (FORCE);"
    docker exec firenet-postgres psql -U firenet -d postgres -c "CREATE DATABASE firenet OWNER firenet;"
    Write-Host "Database reset complete. Tables and seed data will be rebuilt on startup."
}

.\venv\Scripts\Activate.ps1
python -m fastapi dev --host 0.0.0.0