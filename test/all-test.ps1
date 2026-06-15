<#
.SYNOPSIS
    Run the full TFMS test suite with the backend venv interpreter.

.DESCRIPTION
    Locates backend/venv and runs pytest over this test/ folder (scope bucketing,
    visibility, capacity, and the peak-day / super-El-Nino workflow simulations on
    real fire data). DB-backed tests skip themselves when Postgres isn't reachable.

.EXAMPLE
    .\all-test.ps1                      # run everything, concise summary
    .\all-test.ps1 -Report              # show prints (the simulation reports)
    .\all-test.ps1 -WebUsers 50000 -MobileUsers 200000 -Report   # bigger sim population
    .\all-test.ps1 -Install             # install pytest deps into the venv, then run
    .\all-test.ps1 -k bucketing         # forward any extra pytest args
    .\all-test.ps1 test_capacity_summary.py -Report
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [int]$WebUsers,     # simulated admin/web WS clients (default 10000)
    [int]$MobileUsers,  # simulated field officers / location pings (default 50000)
    [switch]$Report,    # add -s so test prints (the simulation reports) are shown
    [switch]$Install,   # pip install pytest + pytest-asyncio into the venv first
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Extra
)

$ErrorActionPreference = 'Stop'

$TestDir = $PSScriptRoot
$Repo = Split-Path $TestDir -Parent
$Py = Join-Path $Repo 'backend\venv\Scripts\python.exe'

if (-not (Test-Path $Py)) {
    Write-Error "backend venv python not found at $Py. Create the venv under backend/ first."
    exit 1
}

Write-Host "TFMS test suite" -ForegroundColor Cyan
Write-Host "  python : $Py"
Write-Host "  tests  : $TestDir"

# the simulations read these env vars; only override when the caller passed a value
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

# run from the test dir so pytest.ini (testpaths=.) finds the suite and any
# forwarded bare filename (e.g. test_capacity_summary.py) resolves correctly
$pytestArgs = @()
if ($Report) { $pytestArgs += '-s' }
if ($Extra)  { $pytestArgs += $Extra }

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
