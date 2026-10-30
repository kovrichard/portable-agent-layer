# Memory System

PAL has its own memory system that persists across sessions AND across tools (Claude Code, opencode, Cursor, Copilot, Codex, Antigravity CLI). Always prefer PAL memory over any tool-native memory system.

## Layout

All memory lives under `~/.pal/memory/`:

```
memory/
├── state/                              # Runtime state (managed by hooks)
│   ├── sessions.json                   # Session registry
│   ├── counts.json                     # Cached counts for greeting
│   ├── last-responses.json             # Cached responses for rating correlation
│   ├── captured-learnings.json         # Session-intelligence dedup map
│   ├── session-names.json              # Generated session titles
│   └── debug.log[.1-.5]                # Rotated hook execution logs
│
├── signals/
│   ├── ratings.jsonl                   # Append-only rating signals (explicit + implicit)
│   └── interaction/YYYY-MM.jsonl       # Measured features of each user turn (never the text)
│
├── relationship/
│   └── opinions-context.md             # Approved opinions, rendered for native loading
│
├── learning/
│   ├── failures/YYYY-MM/*.md           # Low-rating captures from older versions, no longer written
│   └── reflections/                    # Algorithm reflections
│
├── wisdom/
│   └── state/                          # Graduation bookkeeping for pal-analyze
│
└── projects/
    └── <slug>/                         # Per-project history, progress
```

## Where to write

Almost everything in `state/`, `signals/`, `relationship/`, `learning/`, and `wisdom/` is hook-managed — **never edit these directly**. Use the relevant skill or tool instead.

| You want to capture | Go through | Lands at |
|---------------------|------------|----------|
| A rule the user states should hold from now on | `pal cli rule add-opinion` (algorithm LEARN phase) | `adaptation/rules.json` |
| What a session did | Session-intelligence handler (automatic) | `projects/<slug>/` history |
| A rating signal | UserPromptOrchestrator rating capture | `signals/ratings.jsonl` |
| How a user turn went (pace, length, skimming, how it received the last reply) | Prompt-time interaction measurement (automatic, every agent; see the per-agent turn contract in SYSTEM_ARCHITECTURE.md); read it with `pal cli interaction report` | `signals/interaction/YYYY-MM.jsonl` |
| A rolling sample of labelled messages, for auditing the reaction rules | Prompt-time interaction measurement (automatic, `reactionSampling`) | `state/reaction-samples.json` |
| Where a session's work stopped | `pal cli progress stopped`, or the session-intelligence handler at the end of a session | `progress-tree/events.jsonl` |

## Format conventions

- **Opinions**: One `when` situation and one imperative `steering` line each, stored in `adaptation/rules.json` and rendered to `relationship/opinions-context.md`.

## When NOT to write

- Trivial exchanges (greetings, brief acknowledgments) → skip
- Anything already captured in TELOS → skip
- Anything that duplicates an existing opinion → skip
- Anything the user has not stated as a rule — corrections are picked up from the turns automatically
