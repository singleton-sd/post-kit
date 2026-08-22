# Create an issue worktree beside the clone (parent workspace).
#
# Layout (open the parent folder in the editor, not the clone):
#   <parent>/main/                          git clone, stays on main
#   <parent>/worktrees/<id>-<slug>/         this script
#
# Usage (see the "GitHub-native engineering workflow" section of AGENTS.md):
#   powershell -File scripts/add-worktree.ps1 -Issue 174 -Type docs -Slug github-native-orchestration
#   pnpm worktree:add -- -Issue 211 -Type fix -Slug login-redirect

[CmdletBinding()]
param(
  [string]$Issue,
  [string]$TaskId,
  [string]$Type,
  [Parameter(Mandatory = $true)]
  [string]$Slug,
  [switch]$Hotfix,
  [switch]$SkipBootstrap,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# -TaskId is a silent alias for -Issue.
$IssueId = if ($Issue) { $Issue } elseif ($TaskId) { $TaskId } else { $null }
if (-not $IssueId) {
  throw '-Issue is required.'
}

function Get-MainRepoRoot {
  $common = (& git rev-parse --path-format=absolute --git-common-dir 2>$null)
  if (-not $common) {
    throw 'Not inside a git repository. Run from the clone or an existing worktree.'
  }
  $common = $common.Trim()
  $leaf = Split-Path -Leaf $common
  if ($leaf -ne '.git') {
    throw "git-common-dir should end with .git, got: $common"
  }
  return [System.IO.Path]::GetFullPath((Split-Path -Parent $common))
}

$repoRoot = Get-MainRepoRoot
$pathsScript = Join-Path $PSScriptRoot 'worktree-paths.mjs'

$nodeArgs = @(
  $pathsScript,
  '--repo', $repoRoot,
  '--issueId', $IssueId,
  '--slug', $Slug
)
if ($Type) { $nodeArgs += @('--type', $Type) }
if ($Hotfix) { $nodeArgs += '--hotfix' }

$json = & node @nodeArgs
if ($LASTEXITCODE -ne 0) {
  throw 'worktree-paths.mjs failed. Fix Issue/Slug and retry.'
}
$paths = $json | ConvertFrom-Json

Write-Host "Branch:   $($paths.branch)"
Write-Host "Worktree: $($paths.worktreePath)"

if ($DryRun) {
  $paths | ConvertTo-Json -Compress
  exit 0
}

if (Test-Path -LiteralPath $paths.worktreePath) {
  throw "Worktree path already exists: $($paths.worktreePath)"
}

$parent = Split-Path -Parent $paths.worktreePath
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

Write-Host 'Fetching origin/main...'
& git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed.' }

$branchExists = $false
& git show-ref --verify --quiet "refs/heads/$($paths.branch)"
if ($LASTEXITCODE -eq 0) { $branchExists = $true }
& git show-ref --verify --quiet "refs/remotes/origin/$($paths.branch)"
if ($LASTEXITCODE -eq 0) { $branchExists = $true }

if ($branchExists) {
  Write-Host "Adding worktree for existing branch $($paths.branch)"
  & git worktree add $paths.worktreePath $paths.branch
} else {
  Write-Host "Creating $($paths.branch) from origin/main"
  & git worktree add -b $paths.branch $paths.worktreePath origin/main
}
if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed.' }

if (-not $SkipBootstrap) {
  Write-Host 'Bootstrapping worktree dependencies...'
  Push-Location $paths.worktreePath
  try {
    & pnpm bootstrap:worktree
    if ($LASTEXITCODE -ne 0) { throw 'pnpm bootstrap:worktree failed.' }
  } finally {
    Pop-Location
  }
}

Write-Host "Worktree ready: $($paths.worktreePath)"
Write-Host 'Open the parent workspace folder (the directory that contains main\ and worktrees\).'
