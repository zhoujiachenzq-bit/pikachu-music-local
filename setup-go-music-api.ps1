$ErrorActionPreference = 'Stop'

$goVersion = 'go1.26.5'
$goArchiveName = "$goVersion.windows-amd64.zip"
$goArchiveSha256 = '97e6b2a833b6d89f9ff17d25419ac0a7e3b482a044e9ab18cdef834bd834fd38'
$apiTag = 'v1.0.1'
$apiCommit = '3008180a96c30469bcc874b3aa1f2f60edcd622a'
$toolRoot = Join-Path $PSScriptRoot 'data\tools'
$goBuildRoot = Join-Path $toolRoot 'go-build\complete'
$goArchive = Join-Path $toolRoot "go-build\$goArchiveName"
$goExecutable = Join-Path $goBuildRoot 'go\bin\go.exe'
$apiSource = Join-Path $toolRoot 'go-music-api-src'
$apiOutput = Join-Path $toolRoot 'go-music-api\go-music-api-loopback.exe'

New-Item -ItemType Directory -Force -Path (Split-Path $goArchive),(Split-Path $apiOutput) | Out-Null
if (-not (Test-Path -LiteralPath $goArchive)) {
  Write-Host "Downloading $goArchiveName..."
  Invoke-WebRequest -Uri "https://go.dev/dl/$goArchiveName" -OutFile $goArchive -TimeoutSec 300
}
$actualHash = (Get-FileHash -LiteralPath $goArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $goArchiveSha256) { throw "Go archive checksum mismatch: $actualHash" }

if (-not (Test-Path -LiteralPath $goExecutable)) {
  Write-Host 'Extracting the verified Go toolchain...'
  Expand-Archive -LiteralPath $goArchive -DestinationPath $goBuildRoot -Force
}

if (-not (Test-Path -LiteralPath $apiSource)) {
  git clone --depth 1 --branch $apiTag https://github.com/guohuiyuan/go-music-api.git $apiSource
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone go-music-api.' }
}
$checkedOutCommit = (git -C $apiSource rev-parse HEAD).Trim()
if ($checkedOutCommit -ne $apiCommit) { throw "Unexpected go-music-api commit: $checkedOutCommit" }

$mainFile = Join-Path $apiSource 'main.go'
$mainSource = [System.IO.File]::ReadAllText($mainFile)
if ($mainSource.Contains('r.Run(":8080")')) {
  $mainSource = $mainSource.Replace('r.Run(":8080")', 'r.Run("127.0.0.1:8080")')
  [System.IO.File]::WriteAllText($mainFile, $mainSource, [System.Text.UTF8Encoding]::new($false))
}
if (-not $mainSource.Contains('r.Run("127.0.0.1:8080")')) { throw 'Unable to enforce loopback-only binding.' }

$env:Path = "$(Split-Path $goExecutable);$env:Path"
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '0'
$env:GOCACHE = Join-Path $toolRoot 'go-cache\build'
$env:GOMODCACHE = Join-Path $toolRoot 'go-cache\mod'
New-Item -ItemType Directory -Force -Path $env:GOCACHE,$env:GOMODCACHE | Out-Null

Write-Host 'Building loopback-only go-music-api...'
& $goExecutable build -trimpath -ldflags '-s -w' -o $apiOutput .
if ($LASTEXITCODE -ne 0) { throw 'go-music-api build failed.' }
Write-Host "Ready: $apiOutput"
