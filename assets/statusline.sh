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
TOTAL_INPUT=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
WINDOW_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "~"')
REPO=$(echo "$input" | jq -r '.workspace.repo.name // ""')

# No data yet (pre-first API call)
if [ -z "$USED_RAW" ] && [ -z "$REM_RAW" ]; then
  USED=0
  REMAINING=100
fi

# Honor CLAUDE_CODE_AUTO_COMPACT_WINDOW: Claude's used_percentage is measured
# against the full model window, but auto-compact triggers at this token cap —
# so recompute usage against the effective (capped) window when it is set.
# Gated on CLAUDECODE (injected only by Claude Code) — the cap is a user shell
# export that would otherwise leak into Cursor, which does not auto-compact.
if [ -n "$CLAUDECODE" ] && [ -n "$CLAUDE_CODE_AUTO_COMPACT_WINDOW" ] && [ "$CLAUDE_CODE_AUTO_COMPACT_WINDOW" -gt 0 ] 2>/dev/null; then
  EFFECTIVE_WINDOW=$CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if [ -n "$WINDOW_SIZE" ] && [ "$EFFECTIVE_WINDOW" -gt "$WINDOW_SIZE" ] 2>/dev/null; then
    EFFECTIVE_WINDOW=$WINDOW_SIZE
  fi
  USED_TOKENS="$TOTAL_INPUT"
  if [ -z "$USED_TOKENS" ] && [ -n "$WINDOW_SIZE" ] && [ -n "$USED_RAW" ]; then
    USED_TOKENS=$(( ${USED_RAW%.*} * WINDOW_SIZE / 100 ))
  fi
  if [ -n "$USED_TOKENS" ]; then
    USED=$(( USED_TOKENS * 100 / EFFECTIVE_WINDOW ))
    [ "$USED" -gt 100 ] && USED=100
    REMAINING=$(( 100 - USED ))
  fi
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

# PAL settings: at the PAL home's root, or in memory/ until the owner moves it
PAL_SETTINGS="$HOME/.pal/settings.json"
[ -f "$PAL_SETTINGS" ] || PAL_SETTINGS="$HOME/.pal/memory/pal-settings.json"

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

# Rate limits (Pro/Max only — absent for other plans and on Cursor)
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
SEVEN_D=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# Daily soft limit — spending the weekly budget evenly is 100/7 ≈ 14% per day.
# Shows what is still sustainable per day for the rest of the window: remaining
# budget divided by days left. Dropping under the even-pace ideal means future
# days have already been eaten into. Both inputs are server-reported for the
# whole account, so every machine on the account computes the same figure.
# resets_at is Unix epoch seconds.
DAY_STR=""
RESETS_AT=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
if [ -n "$SEVEN_D" ] && [ -n "$RESETS_AT" ]; then
  DAYS_LEFT=$(echo "($RESETS_AT - $(date +%s)) / 86400" | bc -l)
  if (( $(echo "$DAYS_LEFT > 0" | bc -l) )); then
    DAY_IDEAL=$(echo "100 / 7" | bc -l)
    DAY_RATE=$(echo "(100 - $SEVEN_D) / $DAYS_LEFT" | bc -l)
    (( $(echo "$DAY_RATE < 0" | bc -l) )) && DAY_RATE=0
    if (( $(echo "$DAY_RATE < $DAY_IDEAL" | bc -l) )); then
      DAY_COLOR=$RED
      DAY_FLAG=" ⚠️"
    elif (( $(echo "$DAY_RATE < $DAY_IDEAL * 1.1" | bc -l) )); then
      DAY_COLOR=$YELLOW
      DAY_FLAG=""
    else
      DAY_COLOR=$GREEN
      DAY_FLAG=""
    fi
    DAY_STR="${DAY_COLOR}day: $(printf '%.0f' "$DAY_RATE")/$(printf '%.0f' "$DAY_IDEAL")%${DAY_FLAG}${RESET}${DIM}"
  fi
fi

RATE_PARTS=()
[ -n "$FIVE_H" ] && RATE_PARTS+=("5h: ${FIVE_H%.*}%")
[ -n "$SEVEN_D" ] && RATE_PARTS+=("7d: ${SEVEN_D%.*}%")
[ -n "$DAY_STR" ] && RATE_PARTS+=("$DAY_STR")
RATE_STR=""
if [ ${#RATE_PARTS[@]} -gt 0 ]; then
  RATE_JOINED="${RATE_PARTS[0]}"
  for PART in "${RATE_PARTS[@]:1}"; do
    RATE_JOINED="${RATE_JOINED} | ${PART}"
  done
  RATE_STR=" │ ${RATE_JOINED}"
fi

# PAL: Update available check (reads cached result, no network call)
UPDATE_LINE=""
UPDATE_CACHE="$HOME/.pal/cache/update-available.json"
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
    # With daily updates on, PAL applies this when the session closes — so the
    # next step is to restart, not to run the command yourself.
    AUTO_UPDATE=$(jq -r '.autoUpdate.enabled // false' "$PAL_SETTINGS" 2>/dev/null)
    if [ "$AUTO_UPDATE" = "true" ]; then
      UPDATE_LINE="📦 update: $VERSION_STR  restart to apply"
    else
      UPDATE_LINE="📦 update: $VERSION_STR  run: pal cli update"
    fi
  fi
fi

# PAL: Health — what the doctor (health.json) and a rejected Claude call (login-rejected.json) left
PAL_CACHE="$HOME/.pal/cache"
HEALTH_JQ='def count(f): f | if type == "number" and . > 0 then floor else 0 end;
  count(.failing), count(.warnings), (.worst | if type == "string" then . else "" end)'
HEALTH_FIELDS=$(jq -r "$HEALTH_JQ" "$PAL_CACHE/health.json" 2>/dev/null)
{ read -r HEALTH_FAILING; read -r HEALTH_WARNINGS; IFS= read -r HEALTH_WORST; } <<< "$HEALTH_FIELDS"
[[ "$HEALTH_FAILING" =~ ^[0-9]+$ ]] || HEALTH_FAILING=0
[[ "$HEALTH_WARNINGS" =~ ^[0-9]+$ ]] || HEALTH_WARNINGS=0

HEALTH_LABEL=""
HEALTH_MORE=0
HEALTH_COLOR=$RED
if [ -f "$PAL_CACHE/login-rejected.json" ]; then
  if [ "$(jq -r '.auth // empty' "$PAL_CACHE/login-rejected.json" 2>/dev/null)" = "token" ]; then
    HEALTH_LABEL="Claude token rejected"
  else
    HEALTH_LABEL="Claude login rejected"
  fi
  HEALTH_MORE=$HEALTH_FAILING
elif [ "$HEALTH_FAILING" -gt 0 ]; then
  HEALTH_LABEL=${HEALTH_WORST:-Doctor found a failure}
  HEALTH_MORE=$(( HEALTH_FAILING - 1 ))
elif [ "$HEALTH_WARNINGS" -eq 1 ]; then
  HEALTH_LABEL="1 warning"
  HEALTH_COLOR=$YELLOW
elif [ "$HEALTH_WARNINGS" -gt 1 ]; then
  HEALTH_LABEL="$HEALTH_WARNINGS warnings"
  HEALTH_COLOR=$YELLOW
fi
[ "$HEALTH_MORE" -gt 0 ] && HEALTH_LABEL="$HEALTH_LABEL (+$HEALTH_MORE more)"

# Dark factory: one line per task that is building or waiting on the user.
# Reads the tail of each task's own event log, so it stays fast as logs grow.
FACTORY_JQ='
def secs: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
def mins: (now - secs) / 60 | floor;
$task[0] as $t
| ($t.id | sub("^[0-9]{4}-[0-9]{2}-[0-9]{2}-"; "") | .[0:28]) as $name
| (try ($t.pr | capture("/pull/(?<n>[0-9]+)").n) catch "") as $pr
| if $t.status == "waiting" then "🏭 \($name) · ⏸ waiting on you"
  else
    (map(select(.event == "role_run")) | last) as $run
    | (map(select(.event == "gate")) | last) as $gate
    | last as $latest
    | "🏭 \($name)"
      + (if $run == null then " · starting"
         elif $run.step != null and $run.planned != null then " · \($run.step)/\($run.planned) \($run.role) \($run.ts | mins)m"
         else " · \($run.role) \($run.ts | mins)m" end)
      + (if $gate == null then "" elif $gate.result == "pass" then " · gate ✓" else " · gate ✗" end)
      + (if $pr != "" then " · PR #\($pr)" else "" end)
      + (if $latest != null and ($latest.ts | mins) >= 35 then " · ⚠ no activity \($latest.ts | mins)m" else "" end)
  end'
FACTORY_LINES=()
FACTORY_TASKS="${DARK_FACTORY_HOME:-$HOME/.dark-factory}/tasks"
if [ -d "$FACTORY_TASKS" ]; then
  for TASK_JSON in "$FACTORY_TASKS"/*/task.json; do
    [ -f "$TASK_JSON" ] || continue
    case "$(jq -r '.status // ""' "$TASK_JSON" 2>/dev/null)" in
      running|waiting) ;;
      *) continue ;;
    esac
    TASK_EVENTS="${TASK_JSON%/task.json}/events.jsonl"
    FACTORY_LINE=$( { tail -n 300 "$TASK_EVENTS" 2>/dev/null || true; } | jq -rs --slurpfile task "$TASK_JSON" "$FACTORY_JQ" 2>/dev/null)
    [ -n "$FACTORY_LINE" ] && FACTORY_LINES+=("$FACTORY_LINE")
  done
fi

# PAL: The timebox, unattended or minimum run of this folder or of the project it is in
RUN_JQ='
def left: if . >= 60 then "\(. / 60 | floor)h\(. % 60)m" else "\(.)m" end;
.scope as $scope
| ($bindings[$scope] // "") as $root
| (.until | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $until
| select(.done != true and $until > now)
| select($scope == $cwd or ($root != "" and ($cwd == $root or ($cwd | startswith($root + "/")))))
| (($until - now) / 60 | ceil | left) as $left
| ($until | strflocaltime("%H:%M")) as $at
| if .kind == "minimum" then
    (.rounds // [] | length) as $n
    | "🔁 minimum run · floor \($at) · \($left) left · \($n) round\(if $n == 1 then "" else "s" end)"
  elif .kind == "unattended" then "🌙 unattended until \($at) · \($left) left"
  else "⏱ timebox until \($at) · \($left) left" end'
RUN_LINES=()
RUN_DIR="$HOME/.pal/cache/run-mode"
if [ -d "$RUN_DIR" ]; then
  BINDINGS=$(jq -c 'if type == "object" then . else {} end' "$HOME/.pal/bindings.json" 2>/dev/null)
  [ -n "$BINDINGS" ] || BINDINGS='{}'
  PRINCIPAL_TZ=$(jq -r '.identity.principal.timezone // empty' "$PAL_SETTINGS" 2>/dev/null)
  for RUN_JSON in "$RUN_DIR"/*.json; do
    [ -f "$RUN_JSON" ] || continue
    RUN_LINE=$(TZ="${PRINCIPAL_TZ:-UTC}" jq -r --arg cwd "${CWD%/}" --argjson bindings "$BINDINGS" "$RUN_JQ" "$RUN_JSON" 2>/dev/null)
    [ -n "$RUN_LINE" ] && RUN_LINES+=("$RUN_LINE")
  done
fi

# Build PAL indicators
ISC_STR=""
[ "$OPEN_ISCS" -gt 0 ] && ISC_STR="  ${DIM}📋 ${OPEN_ISCS} open ISCs${RESET}"

# Line 1: Model, Directory, Git Branch, Open ISCs
echo -e "${CYAN}[${MODEL}]${RESET} 📁 ${DIR_DISPLAY}${DIM}${GIT_INDICATOR}${RESET}${ISC_STR}"

# Line 2: Context bar; cost segment only when Claude sends it
if [ -n "$COST_STR" ]; then
  echo -e "${CONTEXT_COLOR}${BAR}${RESET} ${USED}% │ ${COST_STR} │ ${REMAINING}% free${DIM}${RATE_STR}${RESET}"
else
  echo -e "${CONTEXT_COLOR}${BAR}${RESET} ${USED}% │ ${REMAINING}% free${DIM}${RATE_STR}${RESET}"
fi

# Line 3: Update available (only when cache says available AND versions differ)
[ -n "$UPDATE_LINE" ] && echo -e "${YELLOW}${UPDATE_LINE}${RESET}"

# Line 3a: Health — the worst failure or the warning count, pointing to the doctor
[ -n "$HEALTH_LABEL" ] && printf '%b%s%b\n' "$HEALTH_COLOR" "⚠️  $HEALTH_LABEL — pal cli doctor" "$RESET"

# Line 3b: Dark-factory tasks that are building or waiting on the user
for FACTORY_LINE in "${FACTORY_LINES[@]}"; do
  echo -e "${CYAN}${FACTORY_LINE}${RESET}"
done

# Line 3c: The run this session works under
for RUN_LINE in "${RUN_LINES[@]}"; do
  echo -e "${YELLOW}${RUN_LINE}${RESET}"
done

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
  "The obstacle is the way.|Marcus Aurelius"
  "Whether you think you can or you think you can't - you are right.|Henry Ford"
  "Everything should be made as simple as possible, but not simpler.|Albert Einstein"
  "You miss 100% of the shots you don't take.|Wayne Gretzky"
)
SLOT=$(( $(date +%s) / 5400 ))
SLOT_OFFSET=$(( $(date +%s) % 5400 ))
if [ $SLOT_OFFSET -lt 1800 ]; then
  QUOTE_IDX=$(( SLOT % ${#QUOTES[@]} ))
  QUOTE_ENTRY="${QUOTES[$QUOTE_IDX]}"
  QUOTE_TEXT="${QUOTE_ENTRY%|*}"
  QUOTE_AUTHOR="${QUOTE_ENTRY##*|}"
  echo -e "${DIM}${ITALIC}\"${QUOTE_TEXT}\" — ${QUOTE_AUTHOR}${RESET}"
fi

exit 0
