# Requires Git for Windows; repo root contains package.json. Works under Windows PowerShell 5+
# BASIC EDUCATION folder name does not matter as long as you run from that clone root.

param(
    [string]$Branch = "main",
    [string]$Remote = "origin"
)

# Git writes progress to stderr; PS 5 treats that as an error stream. Do NOT use Stop here.
Remove-Variable ErrorActionPreference -ErrorAction SilentlyContinue
$ErrorActionPreference = "Continue"

if (-not (Test-Path (Join-Path (Get-Location) "package.json"))) {
    throw 'Run from repo root - folder must contain package.json.'
}

Write-Host ""
Write-Host "[1/4] Stop Node.exe (frees TCP 5002)." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host ""
Write-Host "[2/4] Stash local edits - recover later: git stash list / git stash pop" -ForegroundColor Cyan
$status = @(git status --porcelain)
if ($status.Count -gt 0) {
    git stash push -u -m "windows-force-sync before ${Remote}/${Branch} $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host ""
Write-Host "[3/4] Fetch and align to ${Remote}/${Branch}..." -ForegroundColor Cyan
git fetch $Remote | Out-Host
git checkout $Branch | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "git checkout $Branch failed - run git status."
}
git pull $Remote $Branch --ff-only | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host "Pull --ff-only failed - hard reset to ${Remote}/${Branch}" -ForegroundColor Yellow
    git reset --hard "${Remote}/${Branch}"
}

Write-Host ""
Write-Host "[4/4] Bundle line from public\dashboard.js on disk:" -ForegroundColor Green
$match = @(Select-String -Path ".\public\dashboard.js" -Pattern 'CLIENT_UI_BUNDLE_ID\s*=' -ErrorAction SilentlyContinue |
    Select-Object -First 1)
if ($match) {
    Write-Host ("  " + $match.Line.Trim()) -ForegroundColor Green
}
else {
    Write-Host '  (dashboard.js bundle line not found - wrong folder or broken clone)' -ForegroundColor Red
}

Write-Host ""
Write-Host 'Next:' -ForegroundColor Yellow
Write-Host '  npm install'
Write-Host '  npm start'
Write-Host ''
