#!/bin/bash
# PAI Lite — non-destructive installer
# Usage: bash install.sh [--claude] [--opencode] [--all]
# Default: installs for both targets

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$PAI_DIR/targets/lib.sh"

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║  PAI Lite — Personal AI Infra     ║"
echo "  ║  Non-destructive · Modular        ║"
echo "  ╚═══════════════════════════════════╝"
echo ""

# --- Parse args ---
INSTALL_CLAUDE=0
INSTALL_OPENCODE=0

if [[ $# -eq 0 ]]; then
  INSTALL_CLAUDE=1
  INSTALL_OPENCODE=1
fi

for arg in "$@"; do
  case "$arg" in
    --claude)   INSTALL_CLAUDE=1 ;;
    --opencode) INSTALL_OPENCODE=1 ;;
    --all)      INSTALL_CLAUDE=1; INSTALL_OPENCODE=1 ;;
    --help|-h)
      echo "Usage: bash install.sh [--claude] [--opencode] [--all]"
      echo ""
      echo "  --claude    Install hooks/skills for Claude Code"
      echo "  --opencode  Install context/skills for opencode"
      echo "  --all       Install for both (default)"
      echo ""
      echo "Run from the pai/ directory. Existing config is preserved."
      exit 0
      ;;
    *) error "Unknown option: $arg"; exit 1 ;;
  esac
done

# --- Check dependencies ---
if ! command -v jq &>/dev/null; then
  error "jq is required: brew install jq (macOS) / apt install jq (Linux)"
  exit 1
fi

if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  if ! command -v bun &>/dev/null; then
    error "bun is required for Claude Code hooks: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

# --- Scaffold TELOS files from templates (for fresh clones) ---
scaffold_telos

# --- Seed setup state ---
init_setup_state

# --- Run target installers ---
if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
  echo "━━━ Claude Code ━━━"
  bash "$PAI_DIR/targets/claude/install.sh"
  echo ""
fi

if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
  echo "━━━ opencode ━━━"
  bash "$PAI_DIR/targets/opencode/install.sh"
  echo ""
fi

# --- Ask about implicit sentiment ---
echo ""
echo "  Implicit sentiment detection analyzes each message for"
echo "  sentiment using Haiku API (requires ANTHROPIC_API_KEY)."
echo ""
read -rp "  Enable implicit sentiment detection? [y/N]: " ENABLE_SENTIMENT
echo ""

if [[ "$ENABLE_SENTIMENT" =~ ^[Yy]$ ]]; then
  # Set PAI_IMPLICIT_SENTIMENT=1 in target configs
  if [[ "$INSTALL_CLAUDE" -eq 1 ]]; then
    CLAUDE_SETTINGS="$HOME/.claude/settings.json"
    if [[ -f "$CLAUDE_SETTINGS" ]]; then
      UPDATED=$(jq '.env.PAI_IMPLICIT_SENTIMENT = "1"' "$CLAUDE_SETTINGS")
      echo "$UPDATED" > "$CLAUDE_SETTINGS"
      success "Enabled implicit sentiment in Claude Code settings"
    fi
  fi

  if [[ "$INSTALL_OPENCODE" -eq 1 ]]; then
    OC_CONFIG="$HOME/.config/opencode/config.json"
    if [[ -f "$OC_CONFIG" ]]; then
      UPDATED=$(jq '.env.PAI_IMPLICIT_SENTIMENT = "1"' "$OC_CONFIG")
      echo "$UPDATED" > "$OC_CONFIG"
      success "Enabled implicit sentiment in opencode config"
    fi
  fi
else
  info "Implicit sentiment: disabled (set PAI_IMPLICIT_SENTIMENT=1 to enable later)"
fi

success "Done. Existing config was preserved — only new entries were added."
echo ""
info "Next steps:"
if ! is_setup_complete; then
  info "  1. Start a session — PAI will guide you through first-run setup"
  info "  2. Or fill in telos/*.md manually, then re-run install.sh"
else
  info "  1. Fill in telos/*.md with your info (if not already done)"
  info "  2. Re-run install.sh to regenerate context files"
fi
info "  3. Add skills by dropping .md files into skills/"
info "  4. Uninstall: bash uninstall.sh [--claude] [--opencode]"
