#!/bin/bash
# PAI Lite — uninstaller
# Usage: bash uninstall.sh [--claude] [--opencode] [--all]
# Default: uninstalls from both targets

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$PAI_DIR/targets/lib.sh"

REMOVE_CLAUDE=0
REMOVE_OPENCODE=0

if [[ $# -eq 0 ]]; then
  REMOVE_CLAUDE=1
  REMOVE_OPENCODE=1
fi

for arg in "$@"; do
  case "$arg" in
    --claude)   REMOVE_CLAUDE=1 ;;
    --opencode) REMOVE_OPENCODE=1 ;;
    --all)      REMOVE_CLAUDE=1; REMOVE_OPENCODE=1 ;;
    --help|-h)
      echo "Usage: bash uninstall.sh [--claude] [--opencode] [--all]"
      exit 0
      ;;
    *) error "Unknown option: $arg"; exit 1 ;;
  esac
done

if [[ "$REMOVE_CLAUDE" -eq 1 ]]; then
  echo "━━━ Claude Code ━━━"
  bash "$PAI_DIR/targets/claude/uninstall.sh"
  echo ""
fi

if [[ "$REMOVE_OPENCODE" -eq 1 ]]; then
  echo "━━━ opencode ━━━"
  bash "$PAI_DIR/targets/opencode/uninstall.sh"
  echo ""
fi

success "PAI uninstalled. Your TELOS, skills, and memory are still in $PAI_DIR."
