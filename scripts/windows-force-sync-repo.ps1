# Requires: repository root (folder that contains package.json), Git for Windows, PowerShell 5+
# Fixes:
#   - Local edits to tracked files block `git checkout` / `git pull` (example: modified public/dashboard.js)
#   - Two Node listeners on different ports (:5002 + :5003) showing mismatched UX
#
# Default: aligns working tree with origin/main and stashes YOUR uncommitted edits first.

param(
    [string]$Branch = "main",
    [string]$Remote = "origin"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path (Get-Location) "package.json"))) {
    throw "Run from repo root — the folder containing package.json (e.g. Desktop\BASIC EDUCATION)."
}

Write-Host ""
Write-Host "[1/4] Stop all Node.exe (frees TCP 5002 — avoids stale second server)." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host ""
Write-Host "[2/4] Stash uncommitted edits (recover: git stash list  then  git stash pop)" -ForegroundColor Cyan
$status = @(git status --porcelain)
if ($status.Count -gt 0) {
    git stash push -u -m "windows-force-sync before ${Remote}/${Branch} $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host ""
Write-Host "[3/4] Fetch and match ${Remote}/${Branch} exactly..." -ForegroundColor Cyan
git fetch $Remote
git checkout $Branch
if ($LASTEXITCODE -ne 0) {
    throw "git checkout $Branch failed — run git status"
}
git pull $Remote $Branch --ff-only 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host "Fast-forward pull not possible — resetting to ${Remote}/${Branch}" -ForegroundColor Yellow
    git reset --hard "${Remote}/${Branch}"
}

Write-Host ""
Write-Host "[4/4] Dashboard bundle fingerprint read from YOUR disk NOW:" -ForegroundColor Green
$match = @(Select-String -Path ".\public\dashboard.js" -Pattern 'CLIENT_UI_BUNDLE_ID\s*=' -ErrorAction SilentlyContinue |
    Select-Object -First 1)
if ($match) {
    Write-Host ("  " + $match.Line.Trim()) -ForegroundColor Green
}
else {
    Write-Host "  (dashboard.js bundle line not found — wrong folder or damaged clone)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next commands (run HERE):" -ForegroundColor Yellow
Write-Host "  npm install"
Write-Host "  npm start"
Write-Host "Only open the URL and port printed under 'URL:' once. Prefer Ctrl+F5 on dashboard.`n"
