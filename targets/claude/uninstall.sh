#!/bin/bash
# PAI — Claude Code uninstaller
# Removes only PAI hooks from settings.json, leaves everything else intact.

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$PAI_DIR/targets/lib.sh"

SETTINGS="$HOME/.claude/settings.json"

if [[ ! -f "$SETTINGS" ]]; then
  info "No settings.json found, nothing to do."
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"
info "Backed up settings.json"

# Remove PAI hooks — handles both old flat format and new matcher+hooks format
jq --arg pai "$PAI_DIR" '
  if .hooks then
    .hooks |= with_entries(
      .value |= map(
        select(
          # New format: { matcher, hooks: [{ command }] }
          if .hooks then
            (.hooks | any(.command | test($pai))) | not
          # Old flat format: { type, command }
          elif .command then
            (.command | test($pai)) | not
          else true end
        )
      )
    )
    | .hooks |= with_entries(select(.value | length > 0))
  else . end
  | if .env then del(.env.PAI_DIR) else . end
  | if .env == {} then del(.env) else . end
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

success "Removed PAI hooks and env from settings.json"
info "Skills in ~/.claude/skills/ were left in place — remove manually if desired."
