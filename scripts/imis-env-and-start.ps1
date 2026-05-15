# IMIS Basic Education — CREATE .env + SET PASSWORD + npm start (no git)
# Run: powershell -ExecutionPolicy Bypass -File "C:\dev\Kasienyo\RUN-IMIS-WINDOWS.ps1"
# (same idea as scripts\imis-env-and-start.ps1 but this file sits in the project root so it is easy to find)
# Or run from repo root:  .\RUN-IMIS-WINDOWS.ps1
# Or paste this entire file's contents into PowerShell ISE / save as .ps1 first.

$ErrorActionPreference = "Stop"
$RepoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { "C:\dev\Kasienyo" }

function Set-DotEnvKey {
  param([string]$FilePath, [string]$Key, [string]$Value)
  if (-not (Test-Path -LiteralPath $FilePath)) { return }
  $raw = Get-Content -LiteralPath $FilePath -Raw
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
    Write-Host "Created minimal .env (no .env.example)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Enter the MySQL password for the user in .env (default DB_USER=root)." -ForegroundColor Cyan
Write-Host "Press Enter only if that MySQL user has NO password."
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
Write-Host "Starting server (Ctrl+C to stop)..." -ForegroundColor Green
npm start
