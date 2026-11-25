# Memory System

PAL has its own memory system that persists across sessions AND across tools (Claude Code, opencode, Cursor, Copilot, Codex, Antigravity CLI). Always prefer PAL memory over any tool-native memory system.

## Layout

All memory lives under `~/.pal/memory/`. Every store PAL records to, with its group and folder, is listed in `src/bronze/bronze.ts` in the PAL package.

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
│   └── interaction/YYYY-MM.jsonl       # Measured features of each user turn (never the text)
│
├── content/tool-output/YYYY-MM.jsonl   # Whole result of each tool call, keyed by its tool_call event id
│                                       # (withheld for a call on a sensitive path)
│
├── relationship/
│   └── opinions-context.md             # Approved opinions, rendered for native loading
│
├── learning/
│   └── failures/YYYY-MM/*.md           # Low-rating captures from older versions, no longer written
│
├── wisdom/
│   └── state/                          # Graduation bookkeeping for pal-analyze
│
└── projects/
    └── <slug>/ISA.md                   # Per-project spec and criteria
```

`~/.pal/records/` holds what happened, one folder per store: `ratings/`, `claim-checks/`, `ledger/`, `labelled-turns/`, `rule-events/`, `rule-candidates/`, `run-estimates/`, `reflections/`, `sessions-archive/`, `project-history/<slug>/history.jsonl`, `unbound-history/`, `review-queue/`, `import-log/`, and `raw/claude/` for transcript copies. A home that has not run `pal cli migrate v14-records-stores` keeps these stores in their former folders under `memory/`, and PAL reads them there.

`~/.pal/cache/` sits beside `memory/` and holds machine-local state that is rebuilt on the next read. Any file in it may be deleted at any time; nothing in it is a record, so export skips it.

- `claude-login.json`: when the Claude login expires.
- `health.json`: how many doctor findings fail and warn, and the worst one, written by every doctor report.
- `login-rejected.json`: when a background Claude call was last rejected and in which auth mode; the next call that succeeds deletes it.

## Where to write

Almost everything in `records/`, and in `state/`, `signals/`, `relationship/`, `learning/` and `wisdom/` under `memory/`, is hook-managed — **never edit these directly**. Use the relevant skill or tool instead.

| You want to capture | Go through | Lands at |
|---------------------|------------|----------|
| A rule the user states should hold from now on | `pal cli rule add-opinion` (algorithm LEARN phase) | `adaptation/rules.json` |
| What a session did | Session-intelligence handler (automatic) | `records/project-history/<slug>/history.jsonl` |
| A rating signal | UserPromptOrchestrator rating capture | `records/ratings/ratings.jsonl` |
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
