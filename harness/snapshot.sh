#!/usr/bin/env bash
# harness/snapshot.sh — record an auditable, point-in-time snapshot of the
# environment into a timestamped file under logs/. Generic; contains no
# application logic and adds no security controls.
#
# Captures:
#   * git commit hash, branch, and dirty/clean working-tree state
#   * docker image digests in use (csj/* app images + the base images)
#   * agentic tool CLI versions (claude, codex)
#   * the model name each tool is using
#
# Model names cannot be auto-detected reliably (see logs/environment.md), so pass
# them in via environment variables for a fully-recorded snapshot:
#
#   CSJ_CLAUDE_MODEL=claude-opus-4-8 CSJ_CODEX_MODEL=<model> ./harness/snapshot.sh
#
# When unset, the model fields are written as a manual-entry placeholder.
#
# Usage:
#   ./harness/snapshot.sh
#   bash harness/snapshot.sh            # if not marked executable (e.g. on Windows)

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$LOG_DIR/snapshot_${TS}.txt"

mkdir -p "$LOG_DIR"

have() { command -v "$1" >/dev/null 2>&1; }

MANUAL="(record manually - see logs/environment.md)"

{
  echo "# Environment snapshot"
  echo "timestamp_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: $(hostname)"
  echo

  echo "## git"
  if have git && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    echo "commit: $(git -C "$REPO_ROOT" rev-parse HEAD)"
    echo "branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
    if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
      echo "working_tree: DIRTY (uncommitted changes present)"
    else
      echo "working_tree: clean"
    fi
  else
    echo "commit: (not a git repository, or git not available)"
  fi
  echo

  echo "## docker image digests"
  if have docker; then
    if docker info >/dev/null 2>&1; then
      # App images plus the base images referenced by harness/docker/*.
      docker images --digests \
        --format '{{.Repository}}:{{.Tag}}@{{.Digest}} (id {{.ID}})' 2>/dev/null \
        | grep -E '^(csj/|python:|node:|php:|composer)' \
        || echo "(no matching images present yet)"
    else
      echo "(docker installed but daemon not running)"
    fi
  else
    echo "(docker not available)"
  fi
  echo

  echo "## agentic tools"
  if have claude; then
    echo "claude_version: $(claude --version 2>&1 | head -n1)"
  else
    echo "claude_version: (not installed)"
  fi
  echo "claude_model: ${CSJ_CLAUDE_MODEL:-$MANUAL}"

  if have codex; then
    echo "codex_version: $(codex --version 2>&1 | head -n1)"
  else
    echo "codex_version: (not installed)"
  fi
  echo "codex_model: ${CSJ_CODEX_MODEL:-$MANUAL}"
} > "$OUT"

echo "wrote $OUT"
