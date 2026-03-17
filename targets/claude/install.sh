#!/bin/bash
# PAI — Claude Code target installer
# Merges hooks into existing settings.json (never overwrites).
# Copies skills additively. Generates CLAUDE.md from TELOS.

set -euo pipefail

PAI_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$PAI_DIR/targets/lib.sh"

CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"

# --- Ensure settings.json exists ---
mkdir -p "$CLAUDE_DIR"
if [[ ! -f "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
  info "Created new $SETTINGS"
fi

# --- Back up ---
cp "$SETTINGS" "$SETTINGS.bak.$(date +%s)"
info "Backed up settings.json"

# --- Build hooks payload ---
# Claude Code hook format: { "matcher": "ToolName|...", "hooks": [{ "type": "command", "command": "..." }] }
# matcher="" matches all tools for that event
HOOKS_JSON=$(cat <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun run $PAI_DIR/hooks/LoadContext.ts"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun run $PAI_DIR/hooks/RatingCapture.ts"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bun run $PAI_DIR/hooks/SecurityValidator.ts"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun run $PAI_DIR/hooks/StopOrchestrator.ts"
          }
        ]
      }
    ]
  }
}
EOF
)

# --- Merge hooks additively ---
# For each event, append PAI hook groups to existing array, dedup by command
MERGED=$(jq --argjson new "$HOOKS_JSON" '
  reduce ($new.hooks | to_entries[]) as $entry (.;
    .hooks[$entry.key] = (
      (.hooks[$entry.key] // []) + $entry.value
    )
  )
  # Deduplicate by matcher+command (in case of re-install)
  | .hooks |= with_entries(
      .value |= (group_by(.hooks[0].command // .matcher) | map(first))
    )
' "$SETTINGS")

echo "$MERGED" > "$SETTINGS"
success "Merged hooks into settings.json"

# --- Add PAI_DIR to env ---
UPDATED=$(jq --arg dir "$PAI_DIR" '.env.PAI_DIR = $dir' "$SETTINGS")
echo "$UPDATED" > "$SETTINGS"
info "Set PAI_DIR env var in settings"

# --- Copy skills (additive, no overwrite) ---
SKILLS_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DIR"
for f in "$PAI_DIR"/skills/*.md; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  if [[ ! -f "$SKILLS_DIR/$base" ]]; then
    cp "$f" "$SKILLS_DIR/$base"
    info "Added skill: $base"
  else
    warn "Skill exists, skipping: $base"
  fi
done

# --- Generate CLAUDE.md in PAI dir (project-level context) ---
generate_claude_md "$PAI_DIR/CLAUDE.md"

success "Claude Code installation complete"
echo ""
info "Hooks: 4 (SessionStart, UserPromptSubmit, PreToolUse, Stop)"
info "Skills: $(ls "$PAI_DIR"/skills/*.md 2>/dev/null | wc -l | tr -d ' ')"
info "TELOS: $(ls "$PAI_DIR"/telos/*.md 2>/dev/null | wc -l | tr -d ' ') files"
