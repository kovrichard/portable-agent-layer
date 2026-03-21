# Jarvis — Claude Code wrapper with session summary on exit.
#
# Claude Code writes a session file at ~/.claude/sessions/<PID>.json
# containing the sessionId. We capture this while Claude is running,
# then pass it to the summary script after Claude exits so it can
# filter the transcript to only this session's messages.

# Start Claude in a new process so we can get the PID
$proc = Start-Process -FilePath "claude" -ArgumentList $args -NoNewWindow -PassThru

# Poll for the session file (Claude creates it shortly after starting)
$sessionId = $null
$sessionFile = Join-Path $env:USERPROFILE ".claude" "sessions" "$($proc.Id).json"

for ($i = 0; $i -lt 5; $i++) {
    if (Test-Path $sessionFile) {
        $data = Get-Content $sessionFile | ConvertFrom-Json
        $sessionId = $data.sessionId
        break
    }
    Start-Sleep -Milliseconds 500
}

# Wait for Claude to finish (user pressed ctrl+c or /exit)
$proc.WaitForExit()

# Print session cost summary
if ($sessionId) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $summaryScript = Join-Path $scriptDir ".." "tools" "session-summary.ts"
    & bun run $summaryScript -- --session $sessionId 2>$null
}
