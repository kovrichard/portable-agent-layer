# Event log coverage

Which event each runtime can emit, read from the hook config PAL installs for it
(`assets/templates/settings.claude.json`, `assets/templates/hooks.*.json`,
`src/targets/opencode/plugin.ts`). A runtime gets only what its hooks expose; a
missing hook is recorded here, never synthesised from another event.

| Mark | Meaning |
| ---- | ------- |
| ✅ | Emitted, through the hook named |
| ⛔ | Unsupported: the runtime has no hook that carries this |
| ◻ | Not wired yet: the runtime has a hook, PAL does not listen to it |
| ? | Not yet checked against the runtime's own hook list |

## Hook events

| Event | Claude Code | opencode | Cursor | Copilot | Codex | Antigravity |
| ----- | ----------- | -------- | ------ | ------- | ----- | ----------- |
| `turn` | ✅ UserPromptSubmit | ✅ chat.message | ✅ beforeSubmitPrompt | ✅ userPromptSubmitted | ✅ UserPromptSubmit | ✅ PreInvocation |
| `reply` | ✅ Stop | ✅ session.idle | ✅ stop | ✅ agentStop | ✅ Stop | ✅ Stop |
| `session_start` | ✅ SessionStart | ◻ session.created | ✅ sessionStart | ✅ sessionStart | ✅ SessionStart | ⛔ |
| `session_end` | ✅ SessionEnd | ? | ✅ sessionEnd | ✅ sessionEnd | ✅ SessionEnd | ⛔ |
| `compaction` | ✅ PreCompact | ◻ session.compacted | ◻ preCompact | ◻ preCompact | ◻ PreCompact | ⛔ |
| `tool_call` ok | ✅ PostToolUse | ✅ tool.execute.after | ✅ postToolUse | ✅ postToolUse | ✅ PostToolUse | ✅ PostToolUse |
| `tool_call` failed | ✅ PostToolUseFailure | ? | ✅ postToolUseFailure | ✅ postToolUseFailure | ⛔ | ⛔ |
| `tool_call` denied | ✅ PermissionDenied | ◻ permission.replied | ⛔ | ⛔ | ⛔ | ⛔ |
| `permission_prompt` | ✅ PermissionRequest | ✅ permission.ask | ⛔ | ⛔ | ⛔ | ⛔ |
| `notification` | ✅ Notification | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `hook_timing` stop | ✅ Stop | ✅ session.idle | ✅ stop | ✅ agentStop | ✅ Stop | ✅ Stop |
| `hook_timing` prompt | ✅ UserPromptSubmit | ⛔ in-process | ✅ beforeSubmitPrompt | ✅ userPromptSubmitted | ✅ UserPromptSubmit | ◻ |
| `pal_update` unattended | ✅ SessionEnd | ✅ server.instance.disposed | ✅ sessionEnd | ✅ sessionEnd | ✅ SessionEnd | ⛔ |

A tool call costs the turn no extra process. Claude Code runs `ToolEvent.ts`
async, outside the turn; every other hook runtime logs it from the ledger hook
that already runs after each call (`--tool-events`); opencode logs in-process.

`◻` and `?` cells are the open work. opencode's failed tool call is `?` because
only its unreleased plugin API reports one (`tool.execute.after` with
`status: "error"`). opencode's plugin runs in-process, so it
starts no hook process whose time could be measured.

## Events PAL writes itself

These come from PAL code, not from a runtime hook, so every runtime has them.

| Event | Written when |
| ----- | ------------ |
| `inference_call` | PAL makes a model call of its own (`pal cli infer`, ratings, naming, …) |
| `pal_update` | A self-update runs or is skipped, including `pal cli update` |
| `commitment` | An ISC is kept, dropped, reopened or snoozed, from the CLI or the control room |
| `entity_first_seen` | A person, company, idea or research topic first enters the knowledge store |
| `discord_nag` | The Discord bot reports a nag or its answer through `pal cli events discord-nag` |

## Signals carried as fields, not events

| Signal | Where it lives |
| ------ | -------------- |
| Subagent type, tokens, tool count | `tool_call.subagent*` on the Task / Agent call |
| Skill loaded | `tool_call.skill` on the Skill call |
| Artifact published | `tool_call.tool` on the Artifact call |
| Web search / fetch domain | `tool_call.host` |
| MCP server | `tool_call.mcpServer` |
| Time to answer a permission prompt | `tool_call.promptWaitSec` |
| Time back after a notification | `turn.backAfterSec` |
| Language, pasted size, images, slash command | `turn.language`, `turn.pastedChars`, `turn.images`, `turn.command` |
| Response mode, prompt-to-reply time | `reply.mode`, `reply.latencySec` |
| Timezone change | `session_start.tz` and `session_start.utcOffsetMin`, compared across sessions |
