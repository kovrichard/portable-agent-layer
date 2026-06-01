#!/bin/bash
# PAL Status Line — macOS/Linux
# Reads JSON from stdin (Claude Code / Cursor CLI session data) and prints a formatted status line

input=$(cat)

# Empty or invalid stdin — keep previous status line (Cursor may invoke early)
if [ -z "$input" ] || ! echo "$input" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

# Extract data with fallbacks (Cursor: cwd, worktree.name; Claude: workspace, worktree.branch)
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
USED_RAW=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
REM_RAW=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
USED=$( [ -n "$USED_RAW" ] && echo "${USED_RAW%.*}" || echo 0 )
REMAINING=$( [ -n "$REM_RAW" ] && echo "${REM_RAW%.*}" || echo 0 )
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "~"')
REPO=$(echo "$input" | jq -r '.workspace.repo.name // ""')

# No data yet (pre-first API call)
if [ -z "$USED_RAW" ] && [ -z "$REM_RAW" ]; then
  USED=0
  REMAINING=100
fi

# Git branch — payload first, then git in cwd
BRANCH=$(echo "$input" | jq -r '.worktree.branch // .worktree.name // ""')
if [ -z "$BRANCH" ] || [ "$BRANCH" = "null" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

# Directory label
if [ -n "$REPO" ] && [ "$REPO" != "null" ]; then
  DIR_DISPLAY="$REPO"
else
  DIR_DISPLAY="${CWD##*/}"
fi

if [ -n "$BRANCH" ]; then
  GIT_INDICATOR="  (🌿 ${BRANCH})"
else
  GIT_INDICATOR=""
fi

# Session cost — Claude only; omit segment when absent (Cursor does not send cost)
COST_STR=""
if echo "$input" | jq -e '.cost.total_cost_usd != null' >/dev/null 2>&1; then
  COST=$(echo "$input" | jq -r '.cost.total_cost_usd')
  if (( $(echo "$COST < 0.01" | bc -l) )); then
    COST_STR="free"
  else
    COST_STR=$(printf '$%.2f' "$COST")
  fi
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

# Rate limits (Pro/Max only — absent for other plans and on Cursor)
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
ITALIC='\033[3m'
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

# Line 2: Context bar; cost segment only when Claude sends it
if [ -n "$COST_STR" ]; then
  echo -e "${CONTEXT_COLOR}${BAR}${RESET} ${USED}% │ ${COST_STR} │ ${REMAINING}% free${DIM}${RATE_STR}${RESET}"
else
  echo -e "${CONTEXT_COLOR}${BAR}${RESET} ${USED}% │ ${REMAINING}% free${DIM}${RATE_STR}${RESET}"
fi

# Line 3: Update available (only when cache says available AND versions differ)
[ -n "$UPDATE_LINE" ] && echo -e "${YELLOW}${UPDATE_LINE}${RESET}"

# Line 4: Rotating quote (changes every 30 minutes)
QUOTES=(
  "Make it work, make it right, make it fast.|Kent Beck"
  "Simplicity is the soul of efficiency.|Austin Freeman"
  "Talk is cheap. Show me the code.|Linus Torvalds"
  "First, solve the problem. Then, write the code.|John Johnson"
  "Premature optimization is the root of all evil.|Donald Knuth"
  "The art of programming is organizing complexity.|Edsger Dijkstra"
  "The best code is no code at all.|Jeff Atwood"
  "Truth can only be found in one place: the code.|Robert C. Martin"
  "A ship in harbor is safe — but that is not what ships are for.|John A. Shedd"
  "Before software can be reusable, it first has to be usable.|Ralph Johnson"
  "Good software makes the complex appear simple.|Grady Booch"
  "Measure twice, cut once.|traditional"
  "An expert has made all possible mistakes in a narrow field.|Niels Bohr"
  "Give me six hours to chop down a tree and I will spend the first four sharpening the axe.|Abraham Lincoln"
  "Don't believe everything you read on the internet.|Abraham Lincoln"
  "Good judgement is the result of experience and experience the result of bad judgement.|Mark Twain"
  "We are what we repeatedly do. Excellence is not an act, but a habit.|Aristotle"
  "Knowing yourself is the beginning of all wisdom.|Aristotle"
  "Do what you can, with what you have, where you are.|Theodore Roosevelt"
  "The two most powerful warriors are patience and time.|Leo Tolstoy"
  "Comparison is the thief of joy.|Theodore Roosevelt"
  "To improve is to change; to be perfect is to change often.|Winston Churchill"
  "Absorb what is useful, discard what is useless, add what is essentially your own.|Bruce Lee"
  "It is not what happens to you, but how you react that matters.|Epictetus"
  "He who has a why can bear almost any how.|Friedrich Nietzsche"
  "In the middle of difficulty lies opportunity.|Albert Einstein"
  "A person who never made a mistake never tried anything new.|Albert Einstein"
  "The journey of a thousand miles begins with one step.|Lao Tzu"
)
SLOT=$(( $(date +%s) / 5400 ))
SLOT_OFFSET=$(( $(date +%s) % 5400 ))
if [ $SLOT_OFFSET -lt 900 ]; then
  QUOTE_IDX=$(( SLOT % ${#QUOTES[@]} ))
  QUOTE_ENTRY="${QUOTES[$QUOTE_IDX]}"
  QUOTE_TEXT="${QUOTE_ENTRY%|*}"
  QUOTE_AUTHOR="${QUOTE_ENTRY##*|}"
  echo -e "${DIM}${ITALIC}\"${QUOTE_TEXT}\" — ${QUOTE_AUTHOR}${RESET}"
fi

exit 0
