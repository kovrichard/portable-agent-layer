# Agent hooks reference

Where each agent PAL supports documents its hooks and settings, where PAL installs into it, and how a pre-tool hook blocks a call. Read this before changing a hook, and check the agent's own page before relying on a detail; agents change their hook contracts often.

Links last checked: 2026-11-05.

## The seven surfaces

| Agent | Hook docs | Settings docs | PAL writes | PAL source |
| ----- | --------- | ------------- | ---------- | ---------- |
| Claude Code | [hooks](https://code.claude.com/docs/en/hooks) | [settings](https://code.claude.com/docs/en/settings) | `~/.claude/settings.json` | `assets/templates/settings.claude.json` |
| Cursor | [hooks](https://cursor.com/docs/agent/hooks) | [CLI configuration](https://cursor.com/docs/cli/reference/configuration) | `~/.cursor/hooks.json` | `assets/templates/hooks.cursor.json` |
| Codex | [hooks](https://developers.openai.com/codex/hooks) | [config reference](https://developers.openai.com/codex/config-reference) | `~/.codex/hooks.json` | `assets/templates/hooks.codex.json` |
| Copilot CLI | [hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference) | [config directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) | `~/.copilot/hooks/pal-hooks.json` | `assets/templates/hooks.copilot.json` |
| VS Code (Copilot) | [hooks](https://code.visualstudio.com/docs/copilot/customization/hooks) | [Copilot settings](https://code.visualstudio.com/docs/copilot/reference/copilot-settings) | nothing of its own | runs the Claude Code hooks |
| opencode | [plugins](https://opencode.ai/docs/plugins/) | [config](https://opencode.ai/docs/config/) | `~/.config/opencode/plugins/pal-plugin.ts` | `src/targets/opencode/plugin.ts` |
| Antigravity CLI | [hooks](https://antigravity.google/docs/hooks), offline: `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md` | same offline folder, `json_configs.md` | `~/.gemini/config/plugins/pal/hooks.json` | `assets/templates/hooks.antigravity.json` |

The events PAL wires for each agent are in its template; read them with:

```bash
jq '.hooks // .pal | keys' assets/templates/hooks.cursor.json
```

## Blocking a tool call

Every surface can refuse a tool call before it runs. Six run `SecurityValidator.ts` as their pre-tool hook, and `blockResponse()` in `src/hooks/lib/agent.ts` writes the deny shape for the active agent. opencode runs a plugin instead, which throws. Both call `checkBashCommand()` and `checkFilePath()` in `src/hooks/lib/security.ts`, so a new shell or path refusal belongs there and reaches all seven without a new hook.

| Agent | Pre-tool event | Deny output | Notes |
| ----- | -------------- | ----------- | ----- |
| Claude Code | `PreToolUse` | `hookSpecificOutput.permissionDecision: "deny"` | Exit code 2 also blocks, with stderr shown to the model. |
| Cursor | `preToolUse`, `beforeShellExecution` | `permission: "deny"`, `user_message` | Any deny from any hook source wins; `updated_input` is ignored on `preToolUse`. |
| Codex | `PreToolUse` | `hookSpecificOutput.permissionDecision: "deny"` | Covers Bash, `apply_patch` edits and MCP calls. |
| Copilot CLI | `preToolUse` | `permissionDecision: "deny"` | A hook error denies the call; a timeout falls through to normal permissions. |
| VS Code (Copilot) | `PreToolUse` | as Claude Code | Reads `~/.claude/settings.json`, so a separate file would run every hook twice (`src/targets/copilot/install.ts`). |
| opencode | `tool.execute.before` | throw an error | A plugin function, not a command; `guardShellCall` in `plugin.ts`. |
| Antigravity CLI | `PreToolUse` | `decision: "deny"` | Shell tool is `run_command`, command at `toolCall.args.CommandLine`; also `ask`, `force_ask`. |

## Checking a detail in one minute

Grep the live page instead of reading it:

```bash
curl -sL https://cursor.com/docs/agent/hooks | sed -e 's/<[^>]*>/\n/g' -e 's/&quot;/"/g' | grep -F '"deny"'
```
