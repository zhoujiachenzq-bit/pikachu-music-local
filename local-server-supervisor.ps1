$ErrorActionPreference = 'Continue'

$projectRoot = $PSScriptRoot
$serverEntry = Join-Path $projectRoot 'dist\server\server\index.js'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { $null }

if (-not $nodeExecutable -or -not (Test-Path -LiteralPath $serverEntry)) { exit 1 }

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\PikachuMusicHouseServerSupervisor', [ref]$createdNew)
if (-not $createdNew) { $mutex.Dispose(); exit 0 }

$logDirectory = Join-Path $projectRoot 'data\logs'
$logPath = Join-Path $logDirectory 'local-server.log'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

try {
  while ($true) {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 5MB) {
      Move-Item -LiteralPath $logPath -Destination "$logPath.previous" -Force
    }
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$([DateTime]::Now.ToString('s'))] starting music service"
    & $nodeExecutable $serverEntry 2>&1 | ForEach-Object {
      Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$([DateTime]::Now.ToString('s'))] $_"
    }
    $exitCode = $LASTEXITCODE
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$([DateTime]::Now.ToString('s'))] service exited with code $exitCode; restarting in 2 seconds"
    Start-Sleep -Seconds 2
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
