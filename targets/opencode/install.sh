#!/bin/bash
# PAI — opencode target installer
# Deploys PAI as an opencode plugin + injects TELOS into instructions.
#
# What gets installed:
# 1. Plugin → ~/.config/opencode/plugins/pai-plugin.ts (hooks: security, ratings, context, work capture)
# 2. Instructions → ~/.config/opencode/instructions.md (TELOS context + skills)
# 3. Package deps → ~/.config/opencode/plugins/package.json (@opencode-ai/plugin)

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$PAI_DIR/targets/lib.sh"

OC_GLOBAL_DIR="$HOME/.config/opencode"
OC_PLUGINS_DIR="$OC_GLOBAL_DIR/plugins"
mkdir -p "$OC_PLUGINS_DIR"

# --- 1. Deploy plugin ---
cp "$PAI_DIR/targets/opencode/plugin.ts" "$OC_PLUGINS_DIR/pai-plugin.ts"
success "Deployed plugin to $OC_PLUGINS_DIR/pai-plugin.ts"

# Ensure plugin has access to PAI_DIR
# The plugin reads PAI_DIR from env, so we add it to the plugin file header
sed -i.bak "1s|^|// PAI_DIR=$PAI_DIR\n|" "$OC_PLUGINS_DIR/pai-plugin.ts" 2>/dev/null || true
rm -f "$OC_PLUGINS_DIR/pai-plugin.ts.bak"

# --- 2. Ensure @opencode-ai/plugin type package is available ---
if [[ ! -f "$OC_PLUGINS_DIR/package.json" ]]; then
  cat > "$OC_PLUGINS_DIR/package.json" <<'PKGJSON'
{
  "dependencies": {
    "@opencode-ai/plugin": "latest"
  }
}
PKGJSON
  info "Created package.json for plugin dependencies"
fi

# Install deps if bun is available
if command -v bun &>/dev/null; then
  (cd "$OC_PLUGINS_DIR" && bun install --silent 2>/dev/null) || warn "Could not install plugin deps — run 'cd $OC_PLUGINS_DIR && bun install' manually"
  success "Installed plugin dependencies"
else
  warn "bun not found — opencode will auto-install deps on first run"
fi

# --- 3. Generate instructions from TELOS + skills ---
INSTRUCTIONS="$OC_GLOBAL_DIR/instructions.md"

# Remove existing PAI section if present
if [[ -f "$INSTRUCTIONS" ]] && grep -q "<!-- PAI:START -->" "$INSTRUCTIONS" 2>/dev/null; then
  sed -i.bak '/<!-- PAI:START -->/,/<!-- PAI:END -->/d' "$INSTRUCTIONS"
  rm -f "$INSTRUCTIONS.bak"
  info "Replacing existing PAI section in instructions.md"
fi

{
  echo "<!-- PAI:START -->"
  echo "# Personal Context (TELOS)"
  echo ""
  get_setup_prompt
  build_telos_content
  echo ""

  echo "# Available Skills"
  echo ""
  for f in "$PAI_DIR"/skills/*.md; do
    [[ -f "$f" ]] || continue
    name=$(grep '^name:' "$f" | head -1 | sed 's/name:\s*//')
    desc=$(grep '^description:' "$f" | head -1 | sed 's/description:\s*//')
    echo "- **/$name** — $desc"
  done
  echo ""

  for f in "$PAI_DIR"/skills/*.md; do
    [[ -f "$f" ]] || continue
    echo "---"
    echo ""
    sed '1,/^---$/d' "$f" | sed '1,/^---$/d'
    echo ""
  done

  echo "<!-- PAI:END -->"
} >> "$INSTRUCTIONS"

success "Added TELOS + skills to instructions.md"

# --- 4. Set PAI_DIR in opencode config env ---
OC_CONFIG="$OC_GLOBAL_DIR/config.json"
if [[ ! -f "$OC_CONFIG" ]]; then
  echo '{}' > "$OC_CONFIG"
fi

if command -v jq &>/dev/null; then
  UPDATED=$(jq --arg dir "$PAI_DIR" '.env.PAI_DIR = $dir' "$OC_CONFIG")
  echo "$UPDATED" > "$OC_CONFIG"
  info "Set PAI_DIR in opencode config"
fi

success "opencode installation complete"
echo ""
info "Plugin: $OC_PLUGINS_DIR/pai-plugin.ts"
info "  Hooks: system.transform (TELOS), chat.message (ratings),"
info "         tool.execute.before (security), tool.execute.after (work capture),"
info "         shell.env (PAI_DIR)"
info "Instructions: $INSTRUCTIONS"
info "Skills: $(ls "$PAI_DIR"/skills/*.md 2>/dev/null | wc -l | tr -d ' ') (embedded in instructions)"
