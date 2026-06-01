# PAL Status Line - Windows PowerShell version
# Reads JSON from stdin (Claude Code session data) and prints a formatted status line

$data = $input | Out-String | ConvertFrom-Json

# Extract data with fallbacks (PowerShell 5.1 compatible)
$MODEL = if ($data.model.display_name) { $data.model.display_name } else { "Unknown" }
$USED_RAW = $data.context_window.used_percentage
$USED = if ($USED_RAW -ne $null) { [int]$USED_RAW } else { 0 }
$REM_RAW = $data.context_window.remaining_percentage
$REM = if ($REM_RAW -ne $null) { [int]$REM_RAW } else { 0 }
$COST_RAW = $data.cost.total_cost_usd
$COST = if ($COST_RAW -ne $null) { [double]$COST_RAW } else { 0 }
$CWD = if ($data.workspace.current_dir) { $data.workspace.current_dir } else { "~" }
$REPO = if ($data.workspace.repo.name) { $data.workspace.repo.name } else { "" }

# Extract git branch
$BRANCH = ""
try { $BRANCH = & git -C $CWD rev-parse --abbrev-ref HEAD 2>$null } catch { $BRANCH = "" }

# Format directory
$DIR_DISPLAY = if ($REPO) { $REPO } else { Split-Path -Leaf $CWD }

# Format git branch indicator
$GIT_INDICATOR = if ($BRANCH) { "  (git: $BRANCH)" } else { "" }

# Format cost
$COST_STR = '$' + ([math]::Round($COST, 2)).ToString("0.00")

# PAL: Hook health - count ERROR lines in debug.log from last 24h
$HOOK_ERRORS = 0
$debugLog = Join-Path $env:USERPROFILE ".pal\memory\state\debug.log"
if (Test-Path $debugLog) {
  $cutoff = (Get-Date).AddHours(-24)
  try {
    $HOOK_ERRORS = (Get-Content $debugLog -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '\] ERROR ' } |
      Where-Object {
        $m = [regex]::Match($_, '^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]')
        if ($m.Success) { [datetime]$m.Groups[1].Value -gt $cutoff } else { $false }
      }).Count
  } catch { $HOOK_ERRORS = 0 }
}

# PAL: Open ISC count - find project matching current directory
$OPEN_ISCS = 0
$PROJECT_NAME = ""
$projectsDir = Join-Path $env:USERPROFILE ".pal\memory\projects"
if (Test-Path $projectsDir) {
  try {
    $CWD_NORM = $CWD.Replace('/', '\').TrimEnd('\')
    foreach ($slug in Get-ChildItem $projectsDir -Directory | Select-Object -ExpandProperty Name) {
      $isa = Join-Path $projectsDir "$slug\ISA.md"
      if (-not (Test-Path $isa)) { continue }
      $content = Get-Content $isa -Raw -ErrorAction SilentlyContinue
      $pathMatch = [regex]::Match($content, 'path:\s*"?([^"\n\r]+)"?')
      if ($pathMatch.Success) {
        $projPath = $pathMatch.Groups[1].Value.Trim().Replace('/', '\').TrimEnd('\')
        if ($projPath -eq $CWD_NORM -or $CWD_NORM.StartsWith($projPath)) {
          $PROJECT_NAME = $slug
          $OPEN_ISCS = ([regex]::Matches($content, '- \[ \] ISC-')).Count
          break
        }
      }
    }
  } catch { $OPEN_ISCS = 0 }
}

# Rate limits (Pro/Max only - absent for other plans)
$FIVE_H_RAW = $data.rate_limits.five_hour.used_percentage
$SEVEN_D_RAW = $data.rate_limits.seven_day.used_percentage
$RATE_PARTS = @()
if ($FIVE_H_RAW -ne $null) { $RATE_PARTS += "5h: $([int]$FIVE_H_RAW)%" }
if ($SEVEN_D_RAW -ne $null) { $RATE_PARTS += "7d: $([int]$SEVEN_D_RAW)%" }
$RATE_STR = if ($RATE_PARTS.Count -gt 0) { " - " + ($RATE_PARTS -join " | ") } else { "" }

# Create context progress bar - if both are 0, data not yet available (pre-first API call)
$NO_DATA = ($USED_RAW -eq $null -and $REM_RAW -eq $null)
if ($NO_DATA) { $USED = 0; $REM = 100 }
$FILLED = [int]($USED / 5)
$EMPTY = 20 - $FILLED
$BAR = ("#" * $FILLED) + ("-" * $EMPTY)

# ANSI color codes (PowerShell 5.1 compatible - use concatenation to avoid array-index expansion)
$ESC = [char]27
$CYAN   = $ESC + "[36m"
$GREEN  = $ESC + "[32m"
$YELLOW = $ESC + "[33m"
$RED    = $ESC + "[31m"
$DIM    = $ESC + "[90m"
$ITALIC = $ESC + "[3m"
$RESET  = $ESC + "[0m"

# Choose bar color based on context usage
$BAR_COLOR = if ($USED -gt 80) { $RED } elseif ($USED -gt 60) { $YELLOW } else { $GREEN }

# PAL: Signal trend (reads 10-min cache written by session intelligence)
$SIGNAL_STR = ""
$signalCache = Join-Path $env:USERPROFILE ".pal\memory\state\signal-cache.json"
if (Test-Path $signalCache) {
  try {
    $sc = Get-Content $signalCache -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if ($sc.today -ne $null) {
      $ARROW = switch ($sc.trend) {
        "up"     { "^"; break }
        "down"   { "v"; break }
        "stable" { "-"; break }
        default  { "?"; break }
      }
      $SIG_TODAY = ([math]::Round([double]$sc.today, 1)).ToString("0.0")
      $SIG_COLOR = if ($sc.trend -eq "up") { $GREEN } elseif ($sc.trend -eq "down") { $RED } else { $DIM }
      $SIGNAL_STR = "  " + $SIG_COLOR + "sig: $SIG_TODAY/10 $ARROW" + $RESET
    }
  } catch {}
}

# PAL: Update available check (reads cached result, no network call)
# Emoji constructed at runtime to avoid PS5.1 UTF-8-without-BOM encoding issues
$UPDATE_LINE = ""
$updateCache = Join-Path $env:USERPROFILE ".pal\memory\state\update-available.json"
if (Test-Path $updateCache) {
  try {
    $uc = Get-Content $updateCache -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    if ($uc.available -eq $true) {
      $versionStr = if ($uc.current -ne $uc.latest) { "$($uc.current) -> $($uc.latest)" } else { $uc.current + " (new commits)" }
      $UPDATE_LINE = "[update] $versionStr  run: pal cli update"
    }
  } catch {}
}

# Build PAL indicators
$HOOK_STR = if ($HOOK_ERRORS -gt 0) { "  " + $RED + "! $HOOK_ERRORS hook err" + $RESET } else { "" }
$ISC_STR  = if ($OPEN_ISCS -gt 0)   { "  " + $DIM + "$OPEN_ISCS open ISCs" + $RESET }  else { "" }

# Line 1: Model, Directory, Git Branch, Hook Health, Open ISCs
Write-Host ($CYAN + "[$MODEL]" + $RESET + " folder: $DIR_DISPLAY" + $DIM + $GIT_INDICATOR + $RESET + $HOOK_STR + $ISC_STR + $SIGNAL_STR)

# Line 2: Context bar with usage percentage, cost, and rate limits
$CTX_STR = "$USED% - $COST_STR - ${REM}% free"
Write-Host ($BAR_COLOR + $BAR + $RESET + " " + $CTX_STR + $DIM + $RATE_STR + $RESET)

# Line 3: Update available (only when cache says available AND versions differ)
if ($UPDATE_LINE) { Write-Host ($YELLOW + $UPDATE_LINE + $RESET) }

# Line 4: Rotating quote (changes every 30 minutes)
$QUOTES = @(
  "Make it work, make it right, make it fast.|Kent Beck"
  "Simplicity is the soul of efficiency.|Austin Freeman"
  "Talk is cheap. Show me the code.|Linus Torvalds"
  "First, solve the problem. Then, write the code.|John Johnson"
  "Premature optimization is the root of all evil.|Donald Knuth"
  "The art of programming is organizing complexity.|Edsger Dijkstra"
  "The best code is no code at all.|Jeff Atwood"
  "Truth can only be found in one place: the code.|Robert C. Martin"
  "A ship in harbor is safe - but that is not what ships are for.|John A. Shedd"
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
$QUOTE_IDX = [int]([math]::Floor([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() / 1800)) % $QUOTES.Count
$QUOTE_PARTS = $QUOTES[$QUOTE_IDX] -split '\|'
Write-Host ($DIM + $ITALIC + '"' + $QUOTE_PARTS[0] + '" - ' + $QUOTE_PARTS[1] + $RESET)
