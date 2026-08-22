param(
  [switch]$QuickCheck
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
  param([string]$Message)
  Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Fail {
  param([string]$Message)
  Write-Host "❌ $Message" -ForegroundColor Red
}

try {
  Write-Step "Resolving repository root"
  $gitTopLevel = (& git rev-parse --show-toplevel 2>$null)
  if (-not $gitTopLevel) {
    throw "Not inside a git repository. Run this script from a repo worktree."
  }

  $repoRoot = [System.IO.Path]::GetFullPath($gitTopLevel.Trim())
  Set-Location -Path $repoRoot
  Write-Host "Repo root: $repoRoot"

  Write-Step "Checking prerequisites"
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw "Node.js is not available on PATH. Install Node.js 20+ and retry."
  }

  $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $pnpmCmd) {
    throw "pnpm is not available on PATH. Install pnpm and retry."
  }

  $nodeVersion = (& node --version).Trim()
  $pnpmVersion = (& pnpm --version).Trim()
  Write-Host "Node: $nodeVersion"
  Write-Host "pnpm: $pnpmVersion"

  $nodeMajor = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
  if ($nodeMajor -lt 20) {
    throw "Node.js 20+ is required. Found $nodeVersion."
  }

  Write-Step "Installing workspace dependencies"
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install --frozen-lockfile failed (exit $LASTEXITCODE)." }

  if ($QuickCheck) {
    Write-Step "Running quick readiness check"
    & pnpm test:worktree-paths
    if ($LASTEXITCODE -ne 0) { throw 'pnpm test:worktree-paths failed.' }
  }

  Write-Success "Worktree bootstrap completed."
  if ($QuickCheck) {
    Write-Host "Quick check passed."
  }

  Write-Host "Next steps:" -ForegroundColor Yellow
  Write-Host " - Run targeted tests/builds for your issue before handoff: pnpm test && pnpm lint"
  Write-Host " - See AGENTS.md for the GitHub-native engineering workflow."
}
catch {
  Write-Fail "Worktree bootstrap failed."
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Hint: ensure Node 20+ and pnpm are installed, then rerun this script from the worktree." -ForegroundColor Yellow
  exit 1
}
