# IMIS Basic Education — double-click or run:
#   powershell -ExecutionPolicy Bypass -File "C:\dev\Kasienyo\RUN-IMIS-WINDOWS.ps1"
# This file lives in the PROJECT ROOT (next to package.json) so the path is short and obvious.

$ErrorActionPreference = "Stop"

# When started with -File, $PSScriptRoot is this folder. Fallback for copy-paste use.
$RepoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\dev\Kasienyo" }

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

Set-Location -LiteralPath $RepoRoot

$envFile = Join-Path $RepoRoot ".env"
$example = Join-Path $RepoRoot ".env.example"

if (-not (Test-Path -LiteralPath $envFile)) {
  if (Test-Path -LiteralPath $example) {
    Copy-Item -LiteralPath $example -Destination $envFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
  } else {
    $minimal = @"
NODE_ENV=development
PORT=5002
JWT_SECRET=change-me-very-long-secret
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=iims_school_system
FRONTEND_ORIGIN=http://localhost:5002
"@
    $enc = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($envFile, $minimal.TrimStart() + "`r`n", $enc)
    Write-Host "Created minimal .env (no .env.example found)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "MySQL must be running. Enter password for DB_USER (in .env, usually root)." -ForegroundColor Cyan
Write-Host "Press Enter only if MySQL uses NO password for that user."
$dbPass = Read-Host "DB_PASS"
Set-DotEnvKey -FilePath $envFile -Key "DB_PASS" -Value $dbPass

$jwtLine = Select-String -Path $envFile -Pattern "^JWT_SECRET=" | Select-Object -First 1
$jwtVal = if ($jwtLine) { ($jwtLine.Line -replace "^JWT_SECRET=", "").Trim() } else { "" }
if ([string]::IsNullOrWhiteSpace($jwtVal) -or $jwtVal -eq "change-me-very-long-secret") {
  $rnd = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  Set-DotEnvKey -FilePath $envFile -Key "JWT_SECRET" -Value $rnd
  Write-Host "Set JWT_SECRET to a random value." -ForegroundColor Green
}

Write-Host ""
Write-Host "Starting IMIS (Ctrl+C to stop)..." -ForegroundColor Green
npm start
