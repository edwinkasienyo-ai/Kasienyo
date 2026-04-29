param(
  [string]$Branch = "cursor/autofix-port-fallback-2a2b",
  [string]$RepoZipBase = "https://github.com/edwinkasienyo-ai/Kasienyo/archive/refs/heads",
  [string]$DbPort = "3307",
  [string]$DbHost = "127.0.0.1",
  [string]$DbUser = "root",
  [string]$DbPass = "",
  [string]$DbName = "iims_school_system",
  [string]$Port = "5002",
  [string]$HeroImagePath = ""
)

$ErrorActionPreference = "Stop"

function Download-FileWithFallbacks {
  param(
    [string]$Url,
    [string]$OutFile,
    [int]$MaxAttempts = 4
  )

  $attempt = 1
  while ($attempt -le $MaxAttempts) {
    try {
      Write-Host "[IIMS] Download attempt $attempt/$MaxAttempts via Invoke-WebRequest..." -ForegroundColor DarkGray
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
      if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) {
        return
      }
      throw "Downloaded file is empty."
    } catch {
      Write-Host ("[IIMS] Invoke-WebRequest failed on attempt {0}: {1}" -f $attempt, $_.Exception.Message) -ForegroundColor DarkYellow
      if ($attempt -lt $MaxAttempts) {
        Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
      }
      $attempt++
    }
  }

  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    try {
      Write-Host "[IIMS] Trying curl.exe fallback download..." -ForegroundColor Yellow
      & curl.exe -L --fail --retry 3 --retry-delay 2 -o $OutFile $Url
      if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) {
        return
      }
    } catch {
      Write-Host "[IIMS] curl.exe fallback failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }

  if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
    try {
      Write-Host "[IIMS] Trying BITS fallback download..." -ForegroundColor Yellow
      Start-BitsTransfer -Source $Url -Destination $OutFile -ErrorAction Stop
      if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) {
        return
      }
    } catch {
      Write-Host "[IIMS] BITS fallback failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
  }

  throw "Could not download branch ZIP from $Url. Check internet/firewall/proxy settings, then rerun."
}

function Sync-ProjectFromZip {
  param(
    [string]$ProjectRoot,
    [string]$BranchName,
    [string]$ZipBaseUrl
  )

  $safeBranch = $BranchName -replace "[/\\]", "-"
  $zipUrl = "$ZipBaseUrl/$BranchName.zip"
  $tempBase = Join-Path $env:TEMP "iims-autofix-$safeBranch"
  $zipPath = Join-Path $tempBase "repo.zip"
  $extractPath = Join-Path $tempBase "extract"

  if (Test-Path $tempBase) {
    Remove-Item -Path $tempBase -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -Path $extractPath -ItemType Directory -Force | Out-Null

  Write-Host "[IIMS] Git unavailable or failed. Downloading latest branch ZIP..." -ForegroundColor Yellow
  Write-Host "[IIMS] Source: $zipUrl" -ForegroundColor DarkGray
  Download-FileWithFallbacks -Url $zipUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

  $sourceRoot = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
  if (!$sourceRoot) {
    throw "Failed to locate extracted project folder in ZIP."
  }

  if (!(Get-Command robocopy -ErrorAction SilentlyContinue)) {
    throw "robocopy was not found. Cannot sync project from ZIP fallback."
  }

  Write-Host "[IIMS] Syncing files from downloaded ZIP..." -ForegroundColor Yellow
  & robocopy $sourceRoot.FullName $ProjectRoot /MIR /XD ".git" "node_modules" "uploads" /XF ".env" ".env.local" ".env.production"
  $rc = $LASTEXITCODE
  if ($rc -gt 7) {
    throw "robocopy failed with exit code $rc"
  }
  Write-Host "[IIMS] ZIP sync completed (robocopy code: $rc)." -ForegroundColor Green
}

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

function Get-PortOwnerProcessId {
  param(
    [int]$TargetPort
  )

  $ownerPid = $null
  try {
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
      $conn = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($conn) {
        $ownerPid = [int]$conn.OwningProcess
      }
    }
  } catch {
    $ownerPid = $null
  }

  if (!$ownerPid) {
    try {
      $netstatRows = netstat -ano | Select-String ":$TargetPort\\s"
      foreach ($row in $netstatRows) {
        $parts = ($row.ToString() -replace "\\s+", " ").Trim().Split(" ")
        if ($parts.Length -ge 5 -and $parts[1] -like "*:$TargetPort") {
          $candidate = [int]$parts[-1]
          if ($candidate -gt 0) {
            $ownerPid = $candidate
            break
          }
        }
      }
    } catch {
      $ownerPid = $null
    }
  }

  return $ownerPid
}

function Test-PortIsFree {
  param(
    [int]$TargetPort
  )
  $ownerPid = Get-PortOwnerProcessId -TargetPort $TargetPort
  return -not [bool]$ownerPid
}

function Find-NextFreePort {
  param(
    [int]$StartingPort,
    [int]$MaxAttempts = 25
  )
  $candidate = $StartingPort
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if (Test-PortIsFree -TargetPort $candidate) {
      return $candidate
    }
    $candidate++
  }
  throw "Could not find a free port in range $StartingPort-$candidate."
}

function Resolve-PortConflict {
  param(
    [int]$TargetPort,
    [string]$EnvFilePath
  )

  $ownerPid = Get-PortOwnerProcessId -TargetPort $TargetPort
  if (!$ownerPid) {
    Write-Host "[IIMS] Port $TargetPort is free." -ForegroundColor Green
    return $TargetPort
  }

  $procName = "unknown"
  try {
    $proc = Get-Process -Id $ownerPid -ErrorAction Stop
    $procName = $proc.ProcessName
  } catch {
    $procName = "unknown"
  }

  Write-Host "[IIMS] Port $TargetPort is currently used by PID $ownerPid ($procName)." -ForegroundColor Yellow
  try {
    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    Start-Sleep -Milliseconds 600
    if (Test-PortIsFree -TargetPort $TargetPort) {
      Write-Host "[IIMS] Stopped PID $ownerPid to free port $TargetPort." -ForegroundColor Green
      return $TargetPort
    }
    Write-Host "[IIMS] PID $ownerPid stopped, but port $TargetPort is still occupied." -ForegroundColor DarkYellow
  } catch {
    Write-Host "[IIMS] Could not stop PID $ownerPid automatically. Trying next available port..." -ForegroundColor DarkYellow
  }

  $fallbackPort = Find-NextFreePort -StartingPort ($TargetPort + 1)
  Write-Host "[IIMS] Switching app port from $TargetPort to $fallbackPort." -ForegroundColor Yellow
  Set-Or-AppendEnvValue -FilePath $EnvFilePath -Key "PORT" -Value "$fallbackPort"
  Set-Or-AppendEnvValue -FilePath $EnvFilePath -Key "FRONTEND_ORIGIN" -Value "http://localhost:$fallbackPort"
  return $fallbackPort
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot

Write-Host "[IIMS] Project root: $projectRoot" -ForegroundColor Cyan

if (!(Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node/npm is not installed or not in PATH. Install Node.js then rerun this script."
}

$hasGit = Get-Command git -ErrorAction SilentlyContinue
if ($hasGit) {
  try {
    Write-Host "[IIMS] Pulling latest code from $Branch..." -ForegroundColor Yellow
    git fetch origin $Branch
    git checkout $Branch
    git pull origin $Branch
  } catch {
    Write-Host "[IIMS] Git pull failed. Switching to ZIP fallback sync..." -ForegroundColor DarkYellow
    Sync-ProjectFromZip -ProjectRoot $projectRoot -BranchName $Branch -ZipBaseUrl $RepoZipBase
  }
} else {
  Sync-ProjectFromZip -ProjectRoot $projectRoot -BranchName $Branch -ZipBaseUrl $RepoZipBase
}

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

$resolvedPort = Resolve-PortConflict -TargetPort ([int]$Port) -EnvFilePath ".env"
if ($resolvedPort -ne [int]$Port) {
  Write-Host "[IIMS] Updated .env to PORT=$resolvedPort and FRONTEND_ORIGIN=http://localhost:$resolvedPort" -ForegroundColor Green
}

Write-Host "\n[IIMS] Setup complete. Starting dev server..." -ForegroundColor Green
npm run dev
