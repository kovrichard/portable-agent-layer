#!/bin/bash
# Shared functions for target installers

info()    { echo -e "\033[0;34m[pai]\033[0m $1"; }
success() { echo -e "\033[0;32m[pai]\033[0m $1"; }
warn()    { echo -e "\033[0;33m[pai]\033[0m $1"; }
error()   { echo -e "\033[0;31m[pai]\033[0m $1" >&2; }

# Copy template files to telos/ if they don't already exist
scaffold_telos() {
  local templates_dir="$PAI_DIR/telos/templates"
  local telos_dir="$PAI_DIR/telos"
  [[ -d "$templates_dir" ]] || return 0
  for tmpl in "$templates_dir"/*.md; do
    [[ -f "$tmpl" ]] || continue
    local base
    base=$(basename "$tmpl")
    if [[ ! -f "$telos_dir/$base" ]]; then
      cp "$tmpl" "$telos_dir/$base"
      info "Created $base from template"
    fi
  done
}

# Build TELOS content from filled-in template files
build_telos_content() {
  local telos_dir="$PAI_DIR/telos"
  for f in "$telos_dir"/*.md; do
    [[ -f "$f" ]] || continue
    local content
    content=$(cat "$f")
    # Skip files that are just empty templates
    local real_lines
    real_lines=$(echo "$content" | grep -v '^#' | grep -v '^<!--' | grep -v '^-->' | grep -v '^$' | grep -v '^\s*$' | grep -cv '^\s*|' || true)
    if [[ "$real_lines" -eq 0 ]]; then
      continue
    fi
    echo "$content"
    echo ""
  done
}

# Check if first-run setup is complete (reads memory/state/setup.json)
is_setup_complete() {
  local setup_file="$PAI_DIR/memory/state/setup.json"
  if [[ ! -f "$setup_file" ]]; then
    return 1  # No setup.json = not complete
  fi
  local completed
  completed=$(jq -r '.completed // false' "$setup_file" 2>/dev/null)
  [[ "$completed" == "true" ]]
}

# Seed setup.json if it doesn't exist (delegates to TS)
init_setup_state() {
  if command -v bun &>/dev/null; then
    bun run "$PAI_DIR/hooks/setup-check.ts" init 2>/dev/null
  fi
}

# Get setup prompt from TS (for embedding in generated files)
get_setup_prompt() {
  if command -v bun &>/dev/null; then
    bun run "$PAI_DIR/hooks/setup-check.ts" prompt 2>/dev/null
  fi
}

# Generate a CLAUDE.md from TELOS + memory pointers + setup instructions
generate_claude_md() {
  local output="$1"
  {
    echo "# PAI Context"
    echo ""

    if ! is_setup_complete; then
      get_setup_prompt
      echo ""
    fi

    build_telos_content

    echo "## Memory"
    echo ""
    echo "- Learning log: $PAI_DIR/memory/signals/learnings.jsonl"
    echo "- Ratings log: $PAI_DIR/memory/signals/ratings.jsonl"
    echo "- Session state: $PAI_DIR/memory/state/current-work.json"
  } > "$output"
}
