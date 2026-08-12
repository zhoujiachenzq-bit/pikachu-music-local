$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$appUrl = 'http://127.0.0.1:3000/'
$healthUrl = 'http://127.0.0.1:3000/api/health'
$backupApiUrl = 'http://127.0.0.1:8080'
$backupExecutable = Join-Path $projectRoot 'data\tools\go-music-api\go-music-api-loopback.exe'

function Test-MusicHouse {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-BackupMusicApi {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$backupApiUrl/api/v1/system/cookies" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-Path -LiteralPath $backupExecutable) {
  if (-not (Test-BackupMusicApi)) {
    Start-Process -FilePath $backupExecutable -WorkingDirectory (Split-Path $backupExecutable) -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 20 -and -not (Test-BackupMusicApi); $attempt++) { Start-Sleep -Milliseconds 250 }
  }
  if (Test-BackupMusicApi) { $env:GO_MUSIC_API_URL = $backupApiUrl }
}

if (-not (Test-MusicHouse)) {
  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path $bundledNode) { $bundledNode } else { $null }

  if (-not $nodeExecutable) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Node.js 24 was not found. Install Node.js and try again.', 'Music House') | Out-Null
    exit 1
  }

  $serverEntry = Join-Path $projectRoot 'dist\server\server\index.js'
  if (-not (Test-Path $serverEntry)) {
    $bundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
    $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
    $pnpmExecutable = if ($pnpmCommand) { $pnpmCommand.Source } elseif (Test-Path $bundledPnpm) { $bundledPnpm } else { $null }
    if (-not $pnpmExecutable) {
      Add-Type -AssemblyName PresentationFramework
      [System.Windows.MessageBox]::Show('The built app and pnpm were not found. Build the project and try again.', 'Music House') | Out-Null
      exit 1
    }
    $env:Path = "$(Split-Path $nodeExecutable);$env:Path"
    & $pnpmExecutable build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  Start-Process -FilePath $nodeExecutable -ArgumentList 'dist/server/server/index.js' -WorkingDirectory $projectRoot -WindowStyle Hidden

  $started = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-MusicHouse) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Music House could not start. Check whether port 3000 is already in use.', 'Music House') | Out-Null
    exit 1
  }
}

Start-Process $appUrl
