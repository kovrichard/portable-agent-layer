#!/bin/bash
# PAL Status Line — Display context usage, model, cost, and git branch
# Reads JSON from stdin (Claude Code session data) and prints a formatted status line

input=$(cat)

# Extract data with fallbacks
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
USED=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
REMAINING=$(echo "$input" | jq -r '.context_window.remaining_percentage // 0' | cut -d. -f1)
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // "~"')
REPO=$(echo "$input" | jq -r '.workspace.repo.name // ""')
WORKTREE=$(echo "$input" | jq -r '.workspace.git_worktree // ""')

# Extract git branch — try multiple sources for robustness
if [ -z "$BRANCH" ]; then
  BRANCH=$(echo "$input" | jq -r '.worktree.branch // ""')
fi
if [ -z "$BRANCH" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

# Format directory — show repo name if available, else just folder name
if [ -n "$REPO" ]; then
  DIR_DISPLAY="$REPO"
else
  DIR_DISPLAY="${CWD##*/}"
fi

# Format git branch with indicator
if [ -n "$BRANCH" ]; then
  GIT_INDICATOR="  (git: $BRANCH)"
else
  GIT_INDICATOR=""
fi

# Format cost — show as $X.XX or 'free' if < $0.01
if (( $(echo "$COST < 0.01" | bc -l) )); then
  COST_STR="free"
else
  COST_STR="\$$COST"
fi

# Create context progress bar (20 chars wide)
FILLED=$((USED / 5))
EMPTY=$((20 - FILLED))
if [ $FILLED -eq 0 ]; then
  BAR="░░░░░░░░░░░░░░░░░░░░"
elif [ $FILLED -eq 20 ]; then
  BAR="████████████████████"
else
  BAR=$(printf '█%.0s' $(seq 1 $FILLED))$(printf '░%.0s' $(seq 1 $EMPTY))
fi

# Color codes (ANSI)
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[90m'
RESET='\033[0m'

# Choose color based on context usage
if [ "$USED" -gt 80 ]; then
  CONTEXT_COLOR=$RED
elif [ "$USED" -gt 60 ]; then
  CONTEXT_COLOR=$YELLOW
else
  CONTEXT_COLOR=$GREEN
fi

# Line 1: Model, Directory, Git Branch
echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR_DISPLAY}${DIM}${GIT_INDICATOR}${RESET}"

# Line 2: Context bar with usage percentage and cost
echo -e "${CONTEXT_COLOR}$BAR${RESET} ${USED}% │ $COST_STR │ ${REMAINING}% free"
