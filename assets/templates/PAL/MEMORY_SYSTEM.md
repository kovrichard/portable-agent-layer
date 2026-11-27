# Memory System

PAL has its own memory system that persists across sessions AND across tools (Claude Code, opencode, Cursor, Copilot, Codex, Antigravity CLI). Always prefer PAL memory over any tool-native memory system.

## Layout

All memory lives under `~/.pal/memory/`. Every store PAL records to, with its group and folder, is listed in `src/bronze/bronze.ts` in the PAL package.

This machine's working state is not memory and lives beside it in `~/.pal/state/` (an install that has not run the move keeps it in `memory/state/`). It is never exported or synced: sessions, session names, the hooks' per-session files, collector cursors and scheduled-prompt marks. What regenerates (agenda, goal links, counts, synthesis) lives in `~/.pal/cache/`.

```
memory/
├── adaptation/                         # Rules, opinions, the reaction audit's samples, eval sets
├── knowledge/                          # People, companies, research
├── relationship/
│   ├── opinions.json
│   └── opinions-context.md             # Approved opinions, rendered for native loading
├── learning/
│   └── failures/YYYY-MM/*.md           # Low-rating captures from older versions, no longer written
├── wisdom/
│   ├── frames/                         # Hand-kept notes
│   └── state/                          # Graduation bookkeeping for pal-analyze
├── actor.json, actors/, machines/      # Who the user is and which machines they use; travels on purpose
└── commitments.json
```

`~/.pal/records/` holds what happened, one folder per store: `ratings/`, `claim-checks/`, `ledger/`, `labelled-turns/`, `rule-events/`, `rule-candidates/`, `run-estimates/`, `reflections/`, `sessions-archive/`, `review-queue/`, `import-log/`, and `raw/claude/` for transcript copies. A home that has not run `pal cli migrate v14-records-stores` keeps these stores in their former folders under `memory/`, and PAL reads them there.

`~/.pal/records/bronze/` holds the bronze event log: `events/YYYY-MM.jsonl`, the text events point to in `event-text/`, and the whole result of each tool call in `tool-output/`, keyed by its tool_call event id (withheld for a call on a sensitive path). Export leaves out `event-text/` and `tool-output/`. A home that has not run `pal cli migrate v16-bronze-to-records` keeps them in `memory/events/` and `memory/content/`.

`~/.pal/work/` holds the user's work, one folder per store: `projects/<slug>/` (ISA.md and session history), `unbound-history/`, `progress-tree/`, `tasks/` for task ISAs and `schedules/`. A home that has not run `pal cli migrate v15-work-stores` keeps them under `memory/`, and PAL reads them there. `commitments.json` stays in `memory/` until the Discord checker reads it through `pal cli`.

`~/.pal/cache/` sits beside `memory/` and holds machine-local state that is rebuilt on the next read. Any file in it may be deleted at any time; nothing in it is a record, so export skips it.

- `claude-login.json`: when the Claude login expires.
- `health.json`: how many doctor findings fail and warn, and the worst one, written by every doctor report.
- `login-rejected.json`: when a background Claude call was last rejected and in which auth mode; the next call that succeeds deletes it.

## Where to write

Almost everything in `records/` and `state/`, and in `relationship/`, `learning/` and `wisdom/state/` under `memory/`, is hook-managed — **never edit these directly**. Use the relevant skill or tool instead.

| You want to capture | Go through | Lands at |
|---------------------|------------|----------|
| A rule the user states should hold from now on | `pal cli rule add-opinion` (algorithm LEARN phase) | `records/rules/rules.jsonl` |
| What a session did | Session-intelligence handler (automatic) | `work/projects/<slug>/history.jsonl` |
| A rating signal | UserPromptOrchestrator rating capture | `records/ratings/ratings.jsonl` |
| How a user turn went (pace, length, skimming, how it received the last reply) | Prompt-time interaction measurement (automatic, every agent; see the per-agent turn contract in SYSTEM_ARCHITECTURE.md); read it with `pal cli interaction report` | `turn` events in `records/bronze/events/` |
| A rolling sample of labelled messages, for auditing the reaction rules; it holds message text, so sync leaves it on its machine | Prompt-time interaction measurement (automatic, `reactionSampling`) | `memory/adaptation/reaction-samples.json` |
| Where a session's work stopped | `pal cli progress stopped`, or the session-intelligence handler at the end of a session | `work/progress-tree/events.jsonl` |

## Format conventions

- **Opinions**: One `when` situation and one imperative `steering` line each, stored as an append-only log in `records/rules/rules.jsonl` (each line a rule's whole state; the newest line per rule counts) and rendered to `relationship/opinions-context.md`.

## When NOT to write

- Trivial exchanges (greetings, brief acknowledgments) → skip
- Anything already captured in TELOS → skip
- Anything that duplicates an existing opinion → skip
- Anything the user has not stated as a rule — corrections are picked up from the turns automatically
