# PAL Status Line

A customizable status line for Claude Code that displays context usage, active model, session cost, current directory, and git branch.

## What It Shows

**Line 1:** Model name, current directory, git branch, hook health, open ISCs, signal trend  
**Line 2:** Context usage progress bar, percentage used, session cost, remaining context, rate limits  
**Line 3:** Update notice (only when a new PAL version is available)

Example output (macOS/Linux):
```
[Opus] 📁 portable-agent-layer  🌿 main  📋 21 open ISCs  sig: 3.0/10 ↓
████████░░░░░░░░░░░░ 45% │ $0.12 │ 55% free
```

Example output (Windows):
```
[Opus] folder: portable-agent-layer  (git: main)  21 open ISCs  sig: 3.0/10 v
########------------ 45% - $0.12 - 55% free
```

Colors adapt based on context usage:
- 🟢 Green: 0-60% used
- 🟡 Yellow: 60-80% used  
- 🔴 Red: >80% used

## Setup

### On macOS / Linux

1. Make the script executable:
```bash
chmod +x ~/.claude/statusline.sh
```

2. Add to `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

The statusline script is at: `portable-agent-layer/assets/statusline.sh`

### Cursor CLI

1. Make the script executable:
```bash
chmod +x ~/.cursor/statusline.sh
```

2. Add to `~/.cursor/cli-config.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.cursor/statusline.sh",
    "padding": 2
  }
}
```

Copy `assets/statusline.sh` to `~/.cursor/statusline.sh` (or symlink). Restart the Cursor CLI after editing config.

On Cursor, session cost and rate limits are usually absent from stdin — the script omits the cost segment and hides rate limits automatically. PAL indicators (hooks, ISCs, signal, update) still read from `~/.pal/memory/state/`.

### On Windows

1. Add to `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -Command \"Get-Content -Raw | & 'C:\\path\\to\\statusline.ps1'\"",
    "padding": 2
  }
}
```

Or copy `statusline.ps1` to `~/.claude/statusline.ps1` and reference it from settings.

The statusline script is at: `portable-agent-layer/assets/statusline.ps1`

## Data Displayed

- **Model:** Active Claude model (Opus, Sonnet, Haiku, etc.)
- **Directory:** Repository name (if in a git repo) or folder name
- **Git Branch:** Current branch, fetched from git worktree or `git` command
- **Hook Health:** Count of ERROR lines in `~/.pal/memory/state/debug.log` from last 24h (hidden when 0)
- **Open ISCs:** Count of unchecked ISCs for the current project (hidden when 0)
- **Signal Trend:** Session quality score from `~/.pal/memory/state/signal-cache.json` with trend arrow
- **Context Bar:** Visual progress bar showing token usage
- **Context %:** Percentage of context window used
- **Cost:** Estimated session cost in USD (shows "free" if <$0.01 on macOS/Linux, `$0.00` on Windows)
- **Remaining %:** Percentage of context window remaining
- **Rate Limits:** 5h and 7d usage percentages (Pro/Max plans only — hidden on other plans)
- **Update Notice:** Shown on line 3 when `~/.pal/memory/state/update-available.json` flags a new version

## Dependencies

- **macOS/Linux:** `bash`, `jq`, `git` (for branch detection)
- **Windows:** PowerShell 7+, `git` (for branch detection)

## Customization

Both scripts use `jq` to parse the JSON data Claude Code sends. You can modify them to:
- Add or remove fields
- Change colors (ANSI escape codes)
- Adjust progress bar width
- Show additional data like effort level, rate limits, or PR status

Available fields are documented in the Claude Code statusline reference:
https://code.claude.com/docs/en/statusline#available-data

## Updates

The status line runs after each assistant message, after `/compact`, and when vim mode toggles. It does not consume API tokens.

Changes to the script appear on your next interaction with Claude Code.
