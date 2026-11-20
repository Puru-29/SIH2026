# Start the AgriSense backend (port 3001) and frontend (port 5173) together.
# Usage (from anywhere):  .\scripts\dev.ps1
# Stop with Ctrl+C here; the backend runs in its own window, close it too.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

# Backend: create .env from the example on first run.
$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend '.env.example') $envFile
    Write-Host 'Created backend\.env from .env.example (set ADMIN_PHONE and ADMIN_PIN for an admin account).'
}

Write-Host 'Starting backend (cargo run) in a new window...'
Start-Process powershell -WorkingDirectory $backend -ArgumentList @(
    '-NoExit', '-Command', "`$env:PORT = '3001'; cargo run"
)

# Frontend: install dependencies on first run, then start Vite here.
Set-Location $frontend
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host 'Installing frontend dependencies (npm install)...'
    npm install
}
Write-Host 'Starting frontend on http://localhost:5173 ...'
npm run dev
