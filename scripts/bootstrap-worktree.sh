#!/usr/bin/env bash
# Bootstrap dependencies in the current git worktree (macOS / Linux / Cloud).
#
# Usage:
#   ./scripts/bootstrap-worktree.sh
#   ./scripts/bootstrap-worktree.sh --quick-check
#   pnpm bootstrap:worktree
#   pnpm bootstrap:worktree:quick

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

QUICK_CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick-check | -QuickCheck)
      QUICK_CHECK=1
      shift
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

echo
echo '==> Resolving repository root'
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die 'Not inside a git repository. Run this script from a repo worktree.'
cd "$REPO_ROOT"
echo "Repo root: $REPO_ROOT"

echo
echo '==> Checking prerequisites'
command -v node >/dev/null 2>&1 || die 'Node.js is not available on PATH. Install Node.js 20+ and retry.'
command -v pnpm >/dev/null 2>&1 || die 'pnpm is not available on PATH. Install pnpm (or enable Corepack) and retry.'

NODE_VERSION="$(node --version)"
PNPM_VERSION="$(pnpm --version)"
echo "Node: $NODE_VERSION"
echo "pnpm: $PNPM_VERSION"

NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node.js 20+ is required. Found $NODE_VERSION."
fi

echo
echo '==> Installing workspace dependencies'
pnpm install --frozen-lockfile

if [[ "$QUICK_CHECK" -eq 1 ]]; then
  echo
  echo '==> Running quick readiness check'
  pnpm test:worktree-paths
fi

echo
echo '✅ Worktree bootstrap completed.'
if [[ "$QUICK_CHECK" -eq 1 ]]; then
  echo 'Quick check passed.'
fi

echo 'Next steps:'
echo ' - pnpm sync:skills   # marketplace skills; do not copy SKILL.md into git'
echo ' - Run targeted tests/builds for your issue before handoff: pnpm test && pnpm lint'
echo ' - See AGENTS.md for the GitHub-native engineering workflow.'
