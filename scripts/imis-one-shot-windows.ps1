# IMIS / Kasienyo — paste ONCE in PowerShell: full path to this file with -File
#   powershell -ExecutionPolicy Bypass -File "C:\dev\Kasienyo\scripts\imis-one-shot-windows.ps1"
#
# Or paste the entire script body from the repo/README into PowerShell ISE / save as .ps1 first.
# Do not paste line-by-line starting at "elseif".

$ErrorActionPreference = "Stop"

# ============ CHANGE ONLY IF YOUR FOLDER IS DIFFERENT ============
$RepoRoot = "C:\dev\Kasienyo"
$Branch   = "cursor/imis-batch-13-status-qb-stem-exam-hints-3b70"
# ================================================================

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

Write-Host "`n=== IMIS: repo update ===" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath "$RepoRoot\.git")) {
  Write-Host "ERROR: Not a git repo: $RepoRoot`nClone first: git clone https://github.com/edwinkasienyo-ai/Kasienyo.git $RepoRoot" -ForegroundColor Red
  exit 1
}
Set-Location -LiteralPath $RepoRoot

Write-Host ">>> git fetch / checkout / pull ($Branch)"
git fetch origin
git checkout $Branch 2>$null
git pull -u origin $Branch

Write-Host "`n=== IMIS: .env (database + JWT) ===" -ForegroundColor Cyan
$envFile = Join-Path $RepoRoot ".env"
$example = Join-Path $RepoRoot ".env.example"
if (-not (Test-Path -LiteralPath $envFile)) {
  if (-not (Test-Path -LiteralPath $example)) {
    Write-Host "ERROR: Missing .env.example — repo may be incomplete." -ForegroundColor Red
    exit 1
  }
  Copy-Item -LiteralPath $example -Destination $envFile
  Write-Host "Created .env from .env.example"
}

Write-Host "MySQL must be running (port 3306). Default user in .env is often 'root'."
$dbPass = Read-Host "Enter MySQL password for DB_USER (from .env, usually root). Press Enter if password is EMPTY"
Set-DotEnvKey -FilePath $envFile -Key "DB_PASS" -Value $dbPass

$jwtLine = Select-String -Path $envFile -Pattern "^JWT_SECRET=" | Select-Object -First 1
$jwtVal = if ($jwtLine) { ($jwtLine.Line -replace "^JWT_SECRET=", "").Trim() } else { "" }
if ([string]::IsNullOrWhiteSpace($jwtVal) -or $jwtVal -eq "change-me-very-long-secret") {
  $rnd = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
  Set-DotEnvKey -FilePath $envFile -Key "JWT_SECRET" -Value $rnd
  Write-Host "Set JWT_SECRET to a random value (recommended)." -ForegroundColor Green
}

Write-Host "`nEnsure MySQL has database from DB_NAME in .env (default: iims_school_system). In MySQL client:"
Write-Host '  CREATE DATABASE IF NOT EXISTS iims_school_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;' -ForegroundColor Gray

Write-Host "`n=== IMIS: npm install + check ===" -ForegroundColor Cyan
if (Test-Path -LiteralPath "$RepoRoot\package-lock.json") {
  npm ci
} else {
  npm install
}
npm run check

Write-Host "`n=== IMIS: start server (stop with Ctrl+C) ===" -ForegroundColor Green
npm start
