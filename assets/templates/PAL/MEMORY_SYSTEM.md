# Memory System

PAL has its own memory system that persists across sessions AND across tools (Claude Code, opencode). Always prefer PAL memory over any tool-native memory system.

## Where to write

- **Wisdom frames**: `~/.agents/PAL/memory/wisdom/frames/` — crystallized principles per domain (loaded every session)
- **Relationship notes**: `~/.agents/PAL/memory/relationship/YYYY-MM/YYYY-MM-DD.md` — daily interaction observations (loaded every session)
- **Session learnings**: `~/.agents/PAL/memory/learning/session/YYYY-MM/*.md` — reusable insights from sessions (loaded every session)
- **Failure captures**: `~/.agents/PAL/memory/learning/failures/YYYY-MM/{timestamp}_{slug}/capture.md` — what went wrong and why
- **Signals**: `~/.agents/PAL/memory/signals/ratings.jsonl` — append-only rating signal log (do not edit directly)

## Format

- **Wisdom frames**: One `.md` file per domain/topic. Each file contains bullet-point principles the user has validated or you've learned. Append new principles to existing files or create new domain files.
- **Relationship notes**: Daily `.md` file with bullet-point observations about the interaction (tone, preferences, corrections).
- **Session learnings**: One `.md` file per session with a `**Title:**` line summarizing what was learned.
- **Failure captures**: One directory per failure, named `{YYYYMMDD-HHmmss}_{slug}/`, containing a `capture.md` with what went wrong and why.

## When to write

- When the user corrects you or gives feedback → wisdom frame
- When you learn something about how the user prefers to work → relationship note
- When a session produces reusable insights → session learning
- When something fails significantly (rating < 6) → failure capture
- Do NOT write memories about trivial exchanges or things already captured in TELOS.
