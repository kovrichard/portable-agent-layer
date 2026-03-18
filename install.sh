#!/bin/bash
export PAI_CLAUDE_DIR="$HOME/.claude"
export PAI_OPENCODE_DIR="$HOME/.config/opencode"
export PAI_AGENTS_DIR="$HOME/.agents"
exec bun run "$(dirname "$0")/install.ts" "$@"
