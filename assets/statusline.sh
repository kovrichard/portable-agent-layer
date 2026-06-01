#!/bin/bash
# PAL Status Line — macOS/Linux
# Reads JSON from stdin (Claude Code session data) and prints a formatted status line

input=$(cat)

# Extract data with fallbacks
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
USED_RAW=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
REM_RAW=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
USED=$( [ -n "$USED_RAW" ] && echo "${USED_RAW%.*}" || echo 0 )
REMAINING=$( [ -n "$REM_RAW" ] && echo "${REM_RAW%.*}" || echo 0 )
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // "~"')
REPO=$(echo "$input" | jq -r '.workspace.repo.name // ""')

# No data yet (pre-first API call)
if [ -z "$USED_RAW" ] && [ -z "$REM_RAW" ]; then
  USED=0; REMAINING=100
fi

# Extract git branch — try multiple sources for robustness
BRANCH=$(echo "$input" | jq -r '.worktree.branch // ""')
if [ -z "$BRANCH" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

# Format directory — show repo name if available, else just folder name
if [ -n "$REPO" ]; then
  DIR_DISPLAY="$REPO"
else
  DIR_DISPLAY="${CWD##*/}"
fi

# Format git branch with emoji indicator
if [ -n "$BRANCH" ]; then
  GIT_INDICATOR="  (🌿 ${BRANCH})"
else
  GIT_INDICATOR=""
fi

# Format cost — show as $X.XX or 'free' if < $0.01
if (( $(echo "$COST < 0.01" | bc -l) )); then
  COST_STR="free"
else
  COST_STR=$(printf '$%.2f' "$COST")
fi

# PAL: Hook health — count ERROR lines in debug.log from last 24h
HOOK_ERRORS=0
DEBUG_LOG="$HOME/.pal/memory/state/debug.log"
if [ -f "$DEBUG_LOG" ]; then
  # Cross-platform 24h cutoff: macOS uses date -v, GNU Linux uses date -d
  CUTOFF=$(date -v-24H "+%Y-%m-%d %H:%M:%S" 2>/dev/null || date -d '24 hours ago' "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
  if [ -n "$CUTOFF" ]; then
    # Log format: [YYYY-MM-DD HH:MM:SS] LEVEL ... — split on [ or ] to get $2 = timestamp
    HOOK_ERRORS=$(grep '\] ERROR ' "$DEBUG_LOG" | awk -F'[][]]' '$2 > "'"$CUTOFF"'"' | wc -l | tr -d ' ')
  else
    HOOK_ERRORS=$(grep -c '\] ERROR ' "$DEBUG_LOG" 2>/dev/null || echo 0)
  fi
fi

# PAL: Open ISC count — find project matching current directory
OPEN_ISCS=0
PROJECTS_DIR="$HOME/.pal/memory/projects"
if [ -d "$PROJECTS_DIR" ]; then
  CWD_NORM="${CWD%/}"
  for ISA in "$PROJECTS_DIR"/*/ISA.md; do
    [ -f "$ISA" ] || continue
    PROJ_PATH=$(grep -m1 'path:' "$ISA" | sed 's/.*path:[[:space:]]*//' | tr -d '"' | tr -d "'" | xargs)
    PROJ_PATH="${PROJ_PATH%/}"
    if [ "$PROJ_PATH" = "$CWD_NORM" ] || [[ "$CWD_NORM" == "${PROJ_PATH}/"* ]]; then
      OPEN_ISCS=$(grep -c '- \[ \] ISC-' "$ISA" 2>/dev/null || echo 0)
      break
    fi
  done
fi

# Rate limits (Pro/Max only — absent for other plans)
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
SEVEN_D=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
RATE_PARTS=()
[ -n "$FIVE_H" ] && RATE_PARTS+=("5h: ${FIVE_H%.*}%")
[ -n "$SEVEN_D" ] && RATE_PARTS+=("7d: ${SEVEN_D%.*}%")
RATE_STR=""
if [ ${#RATE_PARTS[@]} -gt 0 ]; then
  RATE_STR=" │ $(IFS=" | "; echo "${RATE_PARTS[*]}")"
fi

# Create context progress bar (20 chars wide)
FILLED=$((USED / 5))
EMPTY=$((20 - FILLED))
if [ "$FILLED" -le 0 ]; then
  BAR="░░░░░░░░░░░░░░░░░░░░"
elif [ "$FILLED" -ge 20 ]; then
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

# Choose bar color based on context usage
if [ "$USED" -gt 80 ]; then
  CONTEXT_COLOR=$RED
elif [ "$USED" -gt 60 ]; then
  CONTEXT_COLOR=$YELLOW
else
  CONTEXT_COLOR=$GREEN
fi

# PAL: Signal trend (reads 10-min cache written by session intelligence)
SIGNAL_STR=""
SIGNAL_CACHE="$HOME/.pal/memory/state/signal-cache.json"
if [ -f "$SIGNAL_CACHE" ]; then
  SC_TODAY=$(jq -r '.today // empty' "$SIGNAL_CACHE" 2>/dev/null)
  SC_TREND=$(jq -r '.trend // empty' "$SIGNAL_CACHE" 2>/dev/null)
  if [ -n "$SC_TODAY" ]; then
    case "$SC_TREND" in
      up)     ARROW="↑"; SIG_COLOR=$GREEN ;;
      down)   ARROW="↓"; SIG_COLOR=$RED ;;
      stable) ARROW="→"; SIG_COLOR=$DIM ;;
      *)      ARROW="?"; SIG_COLOR=$DIM ;;
    esac
    SIG_TODAY=$(printf "%.1f" "$SC_TODAY")
    SIGNAL_STR="  ${SIG_COLOR}sig: ${SIG_TODAY}/10 ${ARROW}${RESET}"
  fi
fi

# PAL: Update available check (reads cached result, no network call)
UPDATE_LINE=""
UPDATE_CACHE="$HOME/.pal/memory/state/update-available.json"
if [ -f "$UPDATE_CACHE" ]; then
  UC_AVAIL=$(jq -r '.available // false' "$UPDATE_CACHE" 2>/dev/null)
  if [ "$UC_AVAIL" = "true" ]; then
    UC_CURRENT=$(jq -r '.current // ""' "$UPDATE_CACHE" 2>/dev/null)
    UC_LATEST=$(jq -r '.latest // ""' "$UPDATE_CACHE" 2>/dev/null)
    if [ "$UC_CURRENT" != "$UC_LATEST" ]; then
      VERSION_STR="$UC_CURRENT → $UC_LATEST"
    else
      VERSION_STR="$UC_CURRENT (new commits)"
    fi
    UPDATE_LINE="📦 update: $VERSION_STR  run: pal cli update"
  fi
fi

# Build PAL indicators
HOOK_STR=""
[ "$HOOK_ERRORS" -gt 0 ] && HOOK_STR="  ${RED}⚠️  ${HOOK_ERRORS} hook err${RESET}"
ISC_STR=""
[ "$OPEN_ISCS" -gt 0 ] && ISC_STR="  ${DIM}📋 ${OPEN_ISCS} open ISCs${RESET}"

# Line 1: Model, Directory, Git Branch, Hook Health, Open ISCs, Signal
echo -e "${CYAN}[${MODEL}]${RESET} 📁 ${DIR_DISPLAY}${DIM}${GIT_INDICATOR}${RESET}${HOOK_STR}${ISC_STR}${SIGNAL_STR}"

# Line 2: Context bar with usage percentage, cost, and rate limits
echo -e "${CONTEXT_COLOR}${BAR}${RESET} ${USED}% │ ${COST_STR} │ ${REMAINING}% free${DIM}${RATE_STR}${RESET}"

# Line 3: Update available (only when cache says available AND versions differ)
[ -n "$UPDATE_LINE" ] && echo -e "${YELLOW}${UPDATE_LINE}${RESET}"
exit 0
