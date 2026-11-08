# Claude Code only

What PAL ships to Claude Code and not yet to the other agents (opencode, Cursor,
Copilot, Codex, Antigravity). A spec that scopes work to Claude Code adds its row
here in the same PR; the PR that ports it removes the row. Per-event hook coverage
lives in `event-log-coverage.md` and is not repeated here.

## Features

| Feature | Where | Why Claude Code only | Since |
| ------- | ----- | -------------------- | ----- |
| Dark factory | `assets/plugins/dark-factory/` | A Claude Code plugin: roles are Claude Code subagents, `build.mjs` maps tiers to Claude model ids and launches `claude`. Breaks principle 3 (tiers through `pal cli`). | 2026-10 |
| Compaction warning (ISC-100, shadow, in progress) | `compaction_near` event, `pal cli compaction backtest` | Reads Claude Code transcript usage and Claude Code's own compaction rules (window, summary buffer, idle compaction). | 2026-11-08 |
| Last exchange restored after compaction | `src/hooks/CompactRecover.ts` | Wired only in `settings.claude.json` (SessionStart `compact`). | — |

## Hooks wired per agent

From the hook configs PAL installs (`assets/templates/settings.claude.json`,
`assets/templates/hooks.*.json`). opencode runs its hooks in-process
(`src/targets/opencode/plugin.ts`) and is not listed.

| Hook | Claude Code | Cursor | Copilot | Codex | Antigravity |
| ---- | ----------- | ------ | ------- | ----- | ----------- |
| `CompactRecover` | ✅ | — | — | — | — |
| `AttentionEvent` | ✅ | — | — | — | — |
| `RtkWrap` | ✅ | ✅ | ✅ | — | — |
| `SkillGuard` | ✅ | ✅ | ✅ | — | — |
| `LoadContext` | ✅ | ✅ | ✅ | ✅ | — |
| `UserPromptOrchestrator` | ✅ | ✅ | ✅ | ✅ | — |
| `PreCompactPersist` | ✅ | ✅ | ✅ | ✅ | — |
| `SessionClose` | ✅ | ✅ | ✅ | ✅ | — |

A dash means PAL does not wire the hook for that agent; whether the agent has an
equivalent event is recorded in `event-log-coverage.md`.
