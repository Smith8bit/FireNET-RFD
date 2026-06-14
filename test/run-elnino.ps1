<#
.SYNOPSIS
    Run the super-El-Nino worst-case workflow simulation
    (test_super_elnino_workflow.py) on REAL fire data, using the backend venv.

.DESCRIPTION
    Sums three consecutive real peak days (13, 14, 15 April 2026) into a single
    "one day" load (~13,576 hotspots, ~2.6x the worst single day) and drives the
    same 10k web / 50k mobile populations through the fire-handling workflow
    concurrently. The report (-s) is on by default because this test's value is
    the printed cost-model comparison; pass -Quiet to drop it.

    The 13th/14th fixtures self-bootstrap from the live feed if missing (needs
    network on first run). Population sizes are read from env vars by the test;
    override them with -WebUsers / -MobileUsers (defaults: 10000 web, 50000 mobile).

.EXAMPLE
    .\run-elnino.ps1                            # 10k web / 50k mobile, full report
    .\run-elnino.ps1 -WebUsers 50000 -MobileUsers 200000
    .\run-elnino.ps1 -Install                   # install pytest deps first, then run
    .\run-elnino.ps1 -Quiet -k cost_model       # forward extra pytest args
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [int]$WebUsers,     # simulated admin/web WS clients (default 10000)
    [int]$MobileUsers,  # simulated field officers / location pings (default 50000)
    [switch]$Quiet,     # drop -s (hide the simulation report prints)
    [switch]$Install,   # pip install pytest + pytest-asyncio into the venv first
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Extra
)

$ErrorActionPreference = 'Stop'

$TestDir = $PSScriptRoot
$Repo = Split-Path $TestDir -Parent
$Py = Join-Path $Repo 'backend\venv\Scripts\python.exe'
$Target = 'test_super_elnino_workflow.py'

if (-not (Test-Path $Py)) {
    Write-Error "backend venv python not found at $Py. Create the venv under backend/ first."
    exit 1
}
if (-not (Test-Path (Join-Path $TestDir $Target))) {
    Write-Error "$Target not found in $TestDir."
    exit 1
}

Write-Host "TFMS super-El-Nino simulation (13-15 Apr 2026 real fire data, summed)" -ForegroundColor Cyan
Write-Host "  python : $Py"
Write-Host "  test   : $Target"

# the simulation reads these env vars; only override when the caller passed a value
if ($PSBoundParameters.ContainsKey('WebUsers'))    { $env:SIM_WEB_USERS = $WebUsers }
if ($PSBoundParameters.ContainsKey('MobileUsers')) { $env:SIM_MOBILE_USERS = $MobileUsers }
$webShown = if ($env:SIM_WEB_USERS) { $env:SIM_WEB_USERS } else { '10000 (default)' }
$mobShown = if ($env:SIM_MOBILE_USERS) { $env:SIM_MOBILE_USERS } else { '50000 (default)' }
Write-Host "  sim    : web=$webShown mobile=$mobShown"

if ($Install) {
    Write-Host "  installing pytest + pytest-asyncio ..." -ForegroundColor Yellow
    & $Py -m pip install -q pytest pytest-asyncio
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# pytest can't run unless it's installed in the venv
& $Py -c "import pytest" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "pytest is not installed in the backend venv. Re-run with -Install."
    exit 1
}

# run from the test dir so pytest.ini (testpaths=.) and the fixture paths resolve
$pytestArgs = @($Target)
if (-not $Quiet) { $pytestArgs += '-s' }
if ($Extra)      { $pytestArgs += $Extra }

Write-Host "  command: python -m pytest $($pytestArgs -join ' ')" -ForegroundColor DarkGray
Write-Host ""

Push-Location $TestDir
try {
    & $Py -m pytest @pytestArgs
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $code
