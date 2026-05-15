# IMIS Windows - Docker MySQL on 3307 + write DB_* into .env (ASCII-only - safe for all PowerShell locales)
# Run from project root (folder with package.json):
#   powershell -ExecutionPolicy Bypass -File ".\scripts\imis-bootstrap-windows.ps1"

$ErrorActionPreference = "Stop"

$MysqlRootPass = "ImisLocalDev2025"
$HostDbPort = "3307"
$ContainerName = "imis-mysql"

# Docker writes "No such container" to stderr; with $ErrorActionPreference Stop, PowerShell 5.x treats that as terminating.
function Invoke-DockerQuiet {
  param([string[]]$DockerArgs)
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  $code = 1
  try {
    & docker @DockerArgs *> $null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEa
  }
  return [int]$code
}

function Set-DotEnvKey {
  param([string]$FilePath, [string]$Key, [string]$Value)
  if (-not (Test-Path -LiteralPath $FilePath)) { return }
  $raw = Get-Content -LiteralPath $FilePath -Raw
  if ($null -eq $raw) { $raw = "" }
  $pat = "(?m)^" + [regex]::Escape($Key) + "=.*$"
  $line = "$Key=" + ($Value -replace "`r|`n", "")
  if ($raw -match $pat) {
    $raw2 = [regex]::Replace($raw, $pat, $line)
  } else {
    $trim = $raw.TrimEnd("`r", "`n")
    $raw2 = if ($trim.Length) { "$trim`r`n$line`r`n" } else { "$line`r`n" }
  }
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($FilePath, $raw2, $enc)
}

$RepoRoot = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path } else { (Get-Location).Path }
$envFile = Join-Path $RepoRoot ".env"
$exFile = Join-Path $RepoRoot ".env.example"

Write-Host ""
Write-Host "=== Repo: $RepoRoot ===" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
  Write-Host "ERROR: package.json not found. cd into your IMIS project folder first." -ForegroundColor Red
  exit 1
}

Set-Location -LiteralPath $RepoRoot

Write-Host ""
Write-Host ">>> Docker daemon check..." -ForegroundColor Cyan
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker is not running. Start Docker Desktop, then run this script again." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $envFile)) {
  if (-not (Test-Path -LiteralPath $exFile)) {
    Write-Host "ERROR: Missing .env.example" -ForegroundColor Red
    exit 1
  }
  Copy-Item -LiteralPath $exFile -Destination $envFile
  Write-Host "Created .env from .env.example" -ForegroundColor Green
}

Write-Host ""
Write-Host ">>> Starting MySQL container $ContainerName on host port $HostDbPort ..." -ForegroundColor Cyan
[void](Invoke-DockerQuiet -DockerArgs @("rm", "-f", "imis_mysql"))
[void](Invoke-DockerQuiet -DockerArgs @("rm", "-f", "--", $ContainerName))

$runArgs = @(
  "run", "-d",
  "--name", $ContainerName,
  "-p", "${HostDbPort}:3306",
  "-e", "MYSQL_ROOT_PASSWORD=$MysqlRootPass",
  "-e", "MYSQL_DATABASE=iims_school_system",
  "mysql:8.4"
)
& docker @runArgs

if ($LASTEXITCODE -ne 0) {
  Write-Host "docker run failed. Edit HostDbPort in this script to 3308 if 3307 is busy." -ForegroundColor Red
  exit 1
}

Write-Host "Waiting for MySQL (first start can take 30-90 seconds)..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  $ping = Invoke-DockerQuiet -DockerArgs @(
    "exec", $ContainerName, "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p${MysqlRootPass}"
  )
  if ($ping -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "MySQL did not become ready. Run: docker logs $ContainerName" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host ">>> Writing DB_* lines to .env" -ForegroundColor Cyan
Set-DotEnvKey -FilePath $envFile -Key "DB_HOST" -Value "127.0.0.1"
Set-DotEnvKey -FilePath $envFile -Key "DB_PORT" -Value $HostDbPort
Set-DotEnvKey -FilePath $envFile -Key "DB_USER" -Value "root"
Set-DotEnvKey -FilePath $envFile -Key "DB_PASS" -Value $MysqlRootPass
Set-DotEnvKey -FilePath $envFile -Key "DB_NAME" -Value "iims_school_system"

$jwtLine = Select-String -Path $envFile -Pattern "^JWT_SECRET=" | Select-Object -First 1
$jwtVal = if ($jwtLine) { ($jwtLine.Line -replace "^JWT_SECRET=", "").Trim() } else { "" }
if ([string]::IsNullOrWhiteSpace($jwtVal) -or $jwtVal -eq "change-me-very-long-secret") {
  $rnd = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 56 | ForEach-Object { [char]$_ })
  Set-DotEnvKey -FilePath $envFile -Key "JWT_SECRET" -Value $rnd
  Write-Host "Set JWT_SECRET to a random value." -ForegroundColor Green
}

Write-Host ""
Write-Host ">>> Verifying Node reads DB_PASS from .env..." -ForegroundColor Cyan
$verifyJs = Join-Path $RepoRoot "scripts\verify-dotenv-db-pass.js"
if (-not (Test-Path -LiteralPath $verifyJs)) {
  Write-Host "ERROR: scripts/verify-dotenv-db-pass.js missing from repo." -ForegroundColor Red
  exit 1
}
node $verifyJs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ('Root password / DB_PASS: ' + $MysqlRootPass)
Write-Host ('MySQL Workbench host 127.0.0.1 port ' + $HostDbPort + ' user root')
Write-Host 'Next run in this folder: npm start' -ForegroundColor Yellow
