$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
.\venv\Scripts\Activate.ps1
fastapi dev
