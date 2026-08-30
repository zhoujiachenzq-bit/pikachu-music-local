$workspaceNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$workspacePnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'

if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeDirectory = Split-Path (Get-Command node).Source
} elseif (Test-Path (Join-Path $workspaceNode 'node.exe')) {
  $nodeDirectory = $workspaceNode
} else {
  throw 'Node.js 24 or newer is required.'
}

$env:PATH = "$nodeDirectory;$env:PATH"
$pnpm = if (Get-Command pnpm -ErrorAction SilentlyContinue) { (Get-Command pnpm).Source } elseif (Test-Path $workspacePnpm) { $workspacePnpm } else { throw 'pnpm is required.' }

$kokoroPython = Join-Path $PSScriptRoot 'data\kokoro\venv\Scripts\python.exe'
$kokoroScript = Join-Path $PSScriptRoot 'scripts\kokoro_tts_server.py'
if ((Test-Path -LiteralPath $kokoroPython) -and (Test-Path -LiteralPath $kokoroScript)) {
  try { $kokoroReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8791/health' -TimeoutSec 2).StatusCode -eq 200 } catch { $kokoroReady = $false }
  if (-not $kokoroReady) {
    $kokoroData = Join-Path $PSScriptRoot 'data\kokoro'
    $env:HF_HOME = Join-Path $kokoroData 'hf-cache'
    $env:HF_HUB_DISABLE_TELEMETRY = '1'
    Start-Process -FilePath $kokoroPython -ArgumentList @($kokoroScript, '--port', '8791') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $kokoroData 'server.stdout.log') -RedirectStandardError (Join-Path $kokoroData 'server.stderr.log')
  }
  $env:KOKORO_TTS_ENABLED = 'true'
  $env:KOKORO_TTS_URL = 'http://127.0.0.1:8791'
  $env:KOKORO_TTS_VOICE = 'zf_001'
}

$backupExecutable = Join-Path $PSScriptRoot 'data\tools\go-music-api\go-music-api-loopback.exe'
if (Test-Path -LiteralPath $backupExecutable) {
  try { $backupReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/v1/system/cookies' -TimeoutSec 2).StatusCode -eq 200 } catch { $backupReady = $false }
  if (-not $backupReady) { Start-Process -FilePath $backupExecutable -WorkingDirectory (Split-Path $backupExecutable) -WindowStyle Hidden; Start-Sleep -Seconds 1 }
  $env:GO_MUSIC_API_URL = 'http://127.0.0.1:8080'
}

& $pnpm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pnpm dev
