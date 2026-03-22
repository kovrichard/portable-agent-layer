#!/bin/bash
export PAL_CLAUDE_DIR="$HOME/.claude"
export PAL_OPENCODE_DIR="$HOME/.config/opencode"
export PAL_AGENTS_DIR="$HOME/.agents"
exec bun run "$(dirname "$0")/install.ts" "$@"
