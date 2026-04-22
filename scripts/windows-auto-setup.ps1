param(
  [string]$Branch = "cursor/iims-full-system-2a2b",
  [string]$DbPort = "3307",
  [string]$DbHost = "127.0.0.1",
  [string]$DbUser = "root",
  [string]$DbPass = "",
  [string]$DbName = "iims_school_system",
  [string]$Port = "5002",
  [string]$HeroImagePath = ""
)

$ErrorActionPreference = "Stop"

function Set-Or-AppendEnvValue {
  param(
    [string]$FilePath,
    [string]$Key,
    [string]$Value
  )

  if (!(Test-Path $FilePath)) {
    Set-Content -Path $FilePath -Value "" -Encoding UTF8
  }

  $escapedKey = [Regex]::Escape($Key)
  $content = Get-Content -Path $FilePath -Raw
  $line = "$Key=$Value"

  if ($content -match "(?m)^$escapedKey=") {
    $content = [Regex]::Replace($content, "(?m)^$escapedKey=.*$", $line)
    Set-Content -Path $FilePath -Value $content -Encoding UTF8
  } else {
    Add-Content -Path $FilePath -Value $line
  }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot

Write-Host "[IIMS] Project root: $projectRoot" -ForegroundColor Cyan

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is not installed or not in PATH. Install Git then rerun this script."
}

if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node/npm is not installed or not in PATH. Install Node.js then rerun this script."
}

Write-Host "[IIMS] Pulling latest code from $Branch..." -ForegroundColor Yellow
git fetch origin $Branch
git checkout $Branch
git pull origin $Branch

if (!(Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env" -Force
  } else {
    Set-Content -Path ".env" -Value "" -Encoding UTF8
  }
}

Set-Or-AppendEnvValue -FilePath ".env" -Key "NODE_ENV" -Value "development"
Set-Or-AppendEnvValue -FilePath ".env" -Key "PORT" -Value $Port
Set-Or-AppendEnvValue -FilePath ".env" -Key "FRONTEND_ORIGIN" -Value "http://localhost:$Port"
Set-Or-AppendEnvValue -FilePath ".env" -Key "DB_HOST" -Value $DbHost
Set-Or-AppendEnvValue -FilePath ".env" -Key "DB_PORT" -Value $DbPort
Set-Or-AppendEnvValue -FilePath ".env" -Key "DB_USER" -Value $DbUser
Set-Or-AppendEnvValue -FilePath ".env" -Key "DB_PASS" -Value $DbPass
Set-Or-AppendEnvValue -FilePath ".env" -Key "DB_NAME" -Value $DbName
Set-Or-AppendEnvValue -FilePath ".env" -Key "IIMS_BUILD_STAMP" -Value "20260422-auto"

if (!(Select-String -Path ".env" -Pattern "^JWT_SECRET=" -Quiet)) {
  $secret = "IIMS_$(Get-Date -Format yyyyMMdd_HHmmss)_AutoSecret_ChangeMe"
  Add-Content -Path ".env" -Value "JWT_SECRET=$secret"
}

if ($HeroImagePath -and (Test-Path $HeroImagePath)) {
  $uploadsDir = Join-Path $projectRoot "uploads"
  if (!(Test-Path $uploadsDir)) {
    New-Item -ItemType Directory -Path $uploadsDir | Out-Null
  }
  Copy-Item -Path $HeroImagePath -Destination (Join-Path $uploadsDir "index-hero.jpg") -Force
  Write-Host "[IIMS] Hero image updated from: $HeroImagePath" -ForegroundColor Green
}

Write-Host "[IIMS] Installing dependencies..." -ForegroundColor Yellow
npm install

$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if ($mysqlCmd) {
  Write-Host "[IIMS] mysql client detected, applying schema + seed..." -ForegroundColor Yellow
  & mysql --host=$DbHost --port=$DbPort --user=$DbUser --password=$DbPass "--execute=CREATE DATABASE IF NOT EXISTS $DbName;"
  Get-Content "sql/schema.sql" | & mysql --host=$DbHost --port=$DbPort --user=$DbUser --password=$DbPass
  Get-Content "sql/seed.sql" | & mysql --host=$DbHost --port=$DbPort --user=$DbUser --password=$DbPass
} else {
  Write-Host "[IIMS] mysql client not found in PATH. Skipping SQL import." -ForegroundColor DarkYellow
  Write-Host "       If DB is empty, import sql/schema.sql and sql/seed.sql manually." -ForegroundColor DarkYellow
}

Write-Host "\n[IIMS] Setup complete. Starting dev server..." -ForegroundColor Green
npm run dev
