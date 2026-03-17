#!/bin/bash
# PAI — opencode uninstaller
# Removes plugin, PAI instructions section, and env config.

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$PAI_DIR/targets/lib.sh"

OC_GLOBAL_DIR="$HOME/.config/opencode"

# --- Remove plugin ---
if [[ -f "$OC_GLOBAL_DIR/plugins/pai-plugin.ts" ]]; then
  rm "$OC_GLOBAL_DIR/plugins/pai-plugin.ts"
  success "Removed PAI plugin"
else
  info "No PAI plugin found"
fi

# --- Remove PAI section from instructions ---
INSTRUCTIONS="$OC_GLOBAL_DIR/instructions.md"
if [[ -f "$INSTRUCTIONS" ]] && grep -q "<!-- PAI:START -->" "$INSTRUCTIONS" 2>/dev/null; then
  sed -i.bak '/<!-- PAI:START -->/,/<!-- PAI:END -->/d' "$INSTRUCTIONS"
  rm -f "$INSTRUCTIONS.bak"
  success "Removed PAI section from instructions.md"
else
  info "No PAI section in instructions.md"
fi

# --- Remove PAI_DIR from config ---
OC_CONFIG="$OC_GLOBAL_DIR/config.json"
if [[ -f "$OC_CONFIG" ]] && command -v jq &>/dev/null; then
  jq 'del(.env.PAI_DIR)' "$OC_CONFIG" > "$OC_CONFIG.tmp" && mv "$OC_CONFIG.tmp" "$OC_CONFIG"
  info "Removed PAI_DIR from opencode config"
fi

# --- Clean up project-level file ---
if [[ -f "$PAI_DIR/opencode.md" ]]; then
  rm "$PAI_DIR/opencode.md"
  info "Removed opencode.md"
fi

success "opencode uninstall complete"
