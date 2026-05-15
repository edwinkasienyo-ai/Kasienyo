# IMIS / Kasienyo — Git pull + npm install + deployment reminders (Windows PowerShell)
# Paste into PowerShell after editing $RepoRoot (path to repo root). Whole-file copy is OK.

$ErrorActionPreference = "Stop"

# === 1) Absolute path to cloned repo (must contain package.json and .git)
$RepoRoot = "C:\path\to\Kasienyo"

# === 2) Branch to deploy (push target from Cursor/cloud agents typically cursor/<feature>-3b70)
$Branch = "cursor/imis-batch-10-polish-3b70"

Set-Location -LiteralPath $RepoRoot

Write-Host "Fetching and checking out $Branch ..."
git fetch origin
$current = (git rev-parse --abbrev-ref HEAD 2>$null)
if ($current -ne $Branch) {
  git checkout $Branch
}
git pull -u origin $Branch

Write-Host "Syntax check (server/app) ..."
npm run check

Write-Host "Installing dependencies ..."
if (Test-Path -LiteralPath ".\package-lock.json") {
  npm ci
}
elseif (Test-Path -LiteralPath ".\package.json") {
  npm install
}
else {
  Write-Host "package.json not found under $RepoRoot" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Optional User-level env (restart terminal / service after setting):" -ForegroundColor Gray
Write-Host '  [Environment]::SetEnvironmentVariable("OPENAI_API_KEY","sk-...","User")   # exam AI stems' -ForegroundColor Gray
Write-Host '  [Environment]::SetEnvironmentVariable("ADMISSION_PUBLIC_BASE_URL","https://your-host","User")' -ForegroundColor Gray
Write-Host '  [Environment]::SetEnvironmentVariable("EXAM_DISABLE_QUESTION_BANK_MCQ","1","User")      # skip MCQ bank blend' -ForegroundColor Gray
Write-Host '  [Environment]::SetEnvironmentVariable("EXAM_DISABLE_QUESTION_BANK_STRUCTURED","1","User") # skip structured bank blend' -ForegroundColor Gray
Write-Host ""
Write-Host "Stop duplicate/old Node listeners on PORT, then start once:" -ForegroundColor Yellow
Write-Host "  npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hard-refresh dashboard (Ctrl+F5) after deploy — dashboard.js is cache-busted via dashboard.html query string." -ForegroundColor Yellow
