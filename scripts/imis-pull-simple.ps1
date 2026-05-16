# IMIS — Simple pull + install (safe to paste as a FILE, or run: powershell -ExecutionPolicy Bypass -File .\scripts\imis-pull-simple.ps1)
# Do NOT copy only the middle of another script into the console — "elseif" alone will error.

$ErrorActionPreference = "Stop"

# === CHANGE THIS to your real folder (yours is C:\dev\Kasienyo if you cloned there)
$RepoRoot = "C:\dev\Kasienyo"
$Branch   = "cursor/imis-batch-13-status-qb-stem-exam-hints-3b70"

Set-Location -LiteralPath $RepoRoot

Write-Host ">>> git fetch / checkout / pull $Branch" -ForegroundColor Cyan
git fetch origin
git checkout $Branch
git pull -u origin $Branch

Write-Host ">>> npm run check" -ForegroundColor Cyan
npm run check

Write-Host ">>> npm install" -ForegroundColor Cyan
if (Test-Path -LiteralPath ".\package-lock.json") {
  npm ci
} else {
  npm install
}

Write-Host ""
Write-Host "Done. Start the app with:  npm start" -ForegroundColor Green
Write-Host "First time: copy .env.example to .env and set DB_PASS (MySQL password), JWT_SECRET, PORT." -ForegroundColor Yellow
