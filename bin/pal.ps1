# Jarvis — Claude Code wrapper with session summary on exit.
#
# After Claude exits, finds the most recently modified transcript JSONL
# in ~/.claude/projects/ and extracts the sessionId from its last line.

$paiDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Run Claude (blocking — keeps the interactive terminal)
& claude @args
$exitCode = $LASTEXITCODE

# Find the most recently modified transcript and extract its session ID
$latest = Get-ChildItem "$env:USERPROFILE\.claude\projects\*\*.jsonl" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($latest) {
    $lastLine = Get-Content $latest.FullName -Tail 1 -ErrorAction SilentlyContinue
    if ($lastLine) {
        try {
            $sessionId = ($lastLine | ConvertFrom-Json).sessionId
            if ($sessionId) {
                $summaryScript = Join-Path $paiDir "tools" "session-summary.ts"
                & bun run $summaryScript -- --session $sessionId 2>$null
            }
        } catch {}
    }
}

exit $exitCode
