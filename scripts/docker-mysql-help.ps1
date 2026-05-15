# IMIS — Discover Docker MySQL password / host port (Windows PowerShell)
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\docker-mysql-help.ps1
#
# Optional: pass container name as first argument:
#   .\scripts\docker-mysql-help.ps1 imis-mysql

$ErrorActionPreference = "Stop"

Write-Host "`n=== Running containers (look for mysql image and PORTS column) ===" -ForegroundColor Cyan
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"

$name = $args[0]
if (-not $name) {
  Write-Host "`nPaste the NAME of your MySQL container (screenshot suggested: imis-mysql)." -ForegroundColor Yellow
  Write-Host "Or press Enter to auto-try: imis-mysql, imis_mysql, imis-mysql-dev" -ForegroundColor Gray
  $name = Read-Host "Container name"
}

$candidates = @()
if ($name) { $candidates += $name }
$candidates += "imis-mysql", "imis_mysql", "imis-mysql-dev"

$found = $false
foreach ($c in $candidates | Select-Object -Unique) {
  if (-not $c) { continue }
  docker inspect $c 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { continue }
  $found = $true

  Write-Host "`n--- Inspect: $c ---" -ForegroundColor Green
  Write-Host "MySQL-related env:"
  docker inspect $c --format "{{range .Config.Env}}{{println .}}{{end}}" | Select-String -Pattern "^MYSQL_"

  Write-Host "`nPublished ports (HOST:CONTAINER — put HOST number in DB_PORT):" -ForegroundColor Yellow
  docker port $c 2>$null
  break
}

if (-not $found) {
  Write-Host "`nNo matching container found. Start MySQL first, or run recreate instructions from README fragment in chat." -ForegroundColor Red
  exit 1
}

Write-Host "`n=== Copy into project .env ===" -ForegroundColor Cyan
Write-Host @"
DB_HOST=127.0.0.1
DB_PORT=<host port: e.g. 3307 from repo docker-compose, or 3306 if mapped that way>
DB_USER=root
DB_PASS=<MYSQL_ROOT_PASSWORD from output above>
DB_NAME=iims_school_system
"@
