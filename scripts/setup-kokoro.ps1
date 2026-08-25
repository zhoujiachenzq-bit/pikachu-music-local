$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$runtimeRoot = Join-Path $projectRoot 'data\kokoro'
$venvRoot = Join-Path $runtimeRoot 'venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$modelCache = Join-Path $runtimeRoot 'hf-cache'
$serverScript = Join-Path $PSScriptRoot 'kokoro_tts_server.py'

if (-not (Test-Path -LiteralPath $bundledPython)) { throw 'Codex bundled Python was not found.' }
New-Item -ItemType Directory -Force -Path $runtimeRoot, $modelCache | Out-Null
if (-not (Test-Path -LiteralPath $venvPython)) { & $bundledPython -m venv $venvRoot }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $venvPython -m pip install --index-url https://download.pytorch.org/whl/cpu torch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $venvPython -m pip install 'kokoro>=0.8.2,<0.10' 'misaki[zh]>=0.8.2,<0.10' 'huggingface_hub>=0.28,<2'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:HF_HOME = $modelCache
$env:HF_HUB_DISABLE_TELEMETRY = '1'
& $venvPython $serverScript --warmup-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Kokoro local voice is installed and warmed up.'
