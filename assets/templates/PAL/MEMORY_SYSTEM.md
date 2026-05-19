# Memory System

PAL has its own memory system that persists across sessions AND across tools (Claude Code, opencode, Cursor, Copilot, Codex). Always prefer PAL memory over any tool-native memory system.

## Layout

All memory lives under `~/.pal/memory/`:

```
memory/
├── state/                              # Runtime state (managed by hooks)
│   ├── sessions.json                   # Session registry
│   ├── counts.json                     # Cached counts for greeting
│   ├── last-responses.json             # Cached responses for rating correlation
│   ├── pending-failure.json            # Deferred failure capture
│   ├── captured-learnings.json         # Session-intelligence dedup map
│   ├── session-names.json              # Generated session titles
│   ├── debug.log[.1-.5]                # Rotated hook execution logs
│   └── token-usage.jsonl               # Per-call inference token usage
│
├── signals/
│   └── ratings.jsonl                   # Append-only rating signals (explicit + implicit)
│
├── relationship/
│   ├── YYYY-MM/YYYY-MM-DD.md           # Daily interaction notes (W / O / B)
│   ├── opinions.json                   # Confidence-tracked opinions
│   └── reflections/                    # Periodic reflection reports
│
├── self-model/
│   └── current.md                      # Synthesized self-model (auto-imported into CLAUDE.md)
│
├── learning/
│   ├── session/YYYY-MM/*.md            # Per-session learnings with frontmatter
│   ├── failures/YYYY-MM/*.md           # Low-rating context captures
│   ├── synthesis/YYYY-MM/*.md          # Weekly/monthly synthesis reports
│   └── .retrieval-index.json           # Embedding index for retrieval
│
├── wisdom/
│   ├── frames/<domain>.md              # Crystallized principles per domain
│   └── state/                          # Wisdom graduation bookkeeping
│
└── projects/
    └── <slug>/                         # Per-project history, threads, progress
```

## Where to write

Almost everything in `state/`, `signals/`, `relationship/opinions.json`, `learning/`, `wisdom/`, and `self-model/` is hook-managed — **never edit these directly**. Use the relevant skill or tool instead.

| You want to capture | Go through | Lands at |
|---------------------|------------|----------|
| A new validated principle | `skill: opinion` (confirm) or wisdom frame edit | `wisdom/frames/<domain>.md` |
| A daily observation about the user | Relationship note in algorithm LEARN phase | `relationship/YYYY-MM/YYYY-MM-DD.md` |
| A reusable session insight | Session-intelligence handler (automatic) | `learning/session/YYYY-MM/*.md` |
| A failure worth learning from | Failure-principle handler (automatic, low ratings) | `learning/failures/YYYY-MM/*.md` |
| A rating signal | UserPromptOrchestrator rating capture | `signals/ratings.jsonl` |
| A project handoff | Project skill / detached handlers | `projects/<slug>/` |

## Format conventions

- **Wisdom frames**: One `.md` file per domain. Bullet-point principles, each tagged with a confidence value (e.g. `(85%)`). Append to existing files when possible; create a new domain only when none fits.
- **Relationship notes**: Daily `.md` file. Each bullet is typed: `W` (world fact), `O(c=0.85)` (opinion), or `B(c=0.75)` (behavior pattern), with a confidence in `c=...`.
- **Session learnings**: Frontmatter (`title`, `category`, `date`, `cwd`, optional `session`) + a body split into `## What Was Done` and `## Insights`.
- **Failure captures**: One `.md` per failure, named `{YYYYMMDD-HHmmss}_{slug}.md`, describing what went wrong, why, and what to do differently.
- **Synthesis reports**: One `.md` per period (`YYYY-MM-DD_weekly.md` etc.) aggregating recurring patterns from session learnings + failures.

## When NOT to write

- Trivial exchanges (greetings, brief acknowledgments) → skip
- Anything already captured in TELOS → skip
- Anything that duplicates an existing wisdom frame or opinion → use the opinion skill to reinforce instead
- Anything the user has not validated yet — record it as a relationship note first, let it graduate naturally
