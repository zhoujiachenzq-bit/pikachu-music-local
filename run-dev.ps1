$workspaceNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$workspacePnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'

if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeDirectory = Split-Path (Get-Command node).Source
} elseif (Test-Path (Join-Path $workspaceNode 'node.exe')) {
  $nodeDirectory = $workspaceNode
} else {
  throw '需要 Node.js 24 或更高版本。'
}

$env:PATH = "$nodeDirectory;$env:PATH"
$pnpm = if (Get-Command pnpm -ErrorAction SilentlyContinue) { (Get-Command pnpm).Source } elseif (Test-Path $workspacePnpm) { $workspacePnpm } else { throw '需要 pnpm。' }

& $pnpm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pnpm dev
