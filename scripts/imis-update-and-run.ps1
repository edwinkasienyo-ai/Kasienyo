# IMIS / Kasienyo — update repo, install, optional OpenAI for exam AI, restart Node
# Paste the entire script into Windows PowerShell. Edit $RepoRoot first.

$ErrorActionPreference = "Stop"

# === 1) Path to your cloned repository (folder containing package.json and .git)
$RepoRoot = "C:\path\to\Kasienyo"

# === 2) Branch to deploy (must exist on origin after push)
$Branch = "cursor/exam-ai-openai-process-once-3b70"

# === 3) Optional: OpenAI for premium MCQ stems (gpt-4o-mini by default)
# Set your key in the User environment once, e.g. in PowerShell:
# [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-your-key-here", "User")
# [Environment]::SetEnvironmentVariable("EXAM_OPENAI_MODEL", "gpt-4o-mini", "User")
# Restart the terminal (or IIS/app pool) so Node sees new variables.

Set-Location -LiteralPath $RepoRoot

Write-Host "Fetching and checking out $Branch ..."
git fetch origin
$current = (git rev-parse --abbrev-ref HEAD 2>$null)
if ($current -ne $Branch) {
  git checkout $Branch
}
git pull -u origin $Branch

Write-Host "Installing dependencies ..."
if (Test-Path -LiteralPath ".\package-lock.json") {
  npm ci
} elseif (Test-Path -LiteralPath ".\package.json") {
  npm install
} else {
  Write-Host "package.json not found under $RepoRoot" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Next: stop any old Node process that is still serving an older build, then start once:" -ForegroundColor Yellow
Write-Host "  npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "Optional (same window before npm start) to enable OpenAI-powered stems:" -ForegroundColor Gray
Write-Host '  $env:OPENAI_API_KEY = "sk-..."' -ForegroundColor Gray
Write-Host '  $env:EXAM_OPENAI_MODEL = "gpt-4o-mini"' -ForegroundColor Gray
Write-Host ""
Write-Host "Hard-refresh the dashboard in the browser (Ctrl+F5) so dashboard.js loads."
Write-Host ""
