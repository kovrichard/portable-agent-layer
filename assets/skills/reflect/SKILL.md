---
name: reflect
description: Diagnose why a PAL behavior did not trigger as expected — trace hooks, instructions, and logic to find the gap. Use when a hook, skill, or automation didn't fire or behaved unexpectedly.
argument-hint: <what went wrong>
---

When the user invokes `/reflect [optional: description of what didn't happen]`:

You are debugging PAL itself. The user noticed that something PAL should have done — automatically or via instructions — did not happen. Your job is to trace the full execution path and find where it broke.

## 1. Identify the expected behavior

If the user described it, restate it clearly. If not, ask:
- **What did you expect PAL to do?** (e.g., update projects.json, write a relationship note, extract wisdom, trigger a hook)
- **When should it have happened?** (during the session, at stop, on prompt submit, on session start)

## 2. Classify the behavior type

Determine which PAL subsystem owns this behavior:

| Type | Mechanism | Key files |
|------|-----------|-----------|
| **Hook-automated** | Runs automatically via StopOrchestrator or UserPromptOrchestrator | `hooks/StopOrchestrator.ts`, `hooks/UserPromptOrchestrator.ts`, `hooks/lib/stop.ts` |
| **Instruction-driven** | AI is told to do it via CLAUDE.md / AGENTS.md instructions | `~/.claude/CLAUDE.md`, project CLAUDE.md files |
| **Context-dependent** | Requires specific context to be loaded at session start | `hooks/LoadContext.ts`, `hooks/lib/context.ts` |
| **Skill-triggered** | Should have been invoked via a skill | `~/.agents/skills/*/SKILL.md` |

## 3. Trace the execution path

Based on the type, investigate the relevant chain:

### For hook-automated behaviors:
1. Read the relevant handler source code in `hooks/handlers/`
2. Check the orchestrator that calls it (`StopOrchestrator.ts` or `UserPromptOrchestrator.ts`)
3. Check `~/.claude/settings.json` to confirm the hook is registered
4. Check PAL logs at `portable-agent-layer/memory/state/debug.log` for errors
5. Check if the handler has conditions that weren't met (e.g., message count < 2, missing session_id)

### For instruction-driven behaviors:
1. Read the relevant CLAUDE.md instructions that should have triggered the behavior
2. Assess whether the instructions are clear and unambiguous enough for the AI to act on
3. Check if the instructions have conditions/triggers — were those conditions met in this session?
4. Consider whether the conversation context made it unlikely the AI would prioritize this action (e.g., too focused on the user's task, no natural pause point)

### For context-dependent behaviors:
1. Check `hooks/LoadContext.ts` and `hooks/lib/context.ts`
2. Verify the expected context was actually injected (check system-reminder content in conversation)
3. Check if context was truncated or missing

### For skill-triggered behaviors:
1. Verify the skill exists in `~/.agents/skills/`
2. Check if SkillGuard blocked it
3. Check if the skill's trigger conditions match what happened

## 4. Identify the gap

State clearly:
- **What should have happened** (the expected behavior)
- **Where it broke** (the specific point in the chain where execution stopped or diverged)
- **Why it broke** (root cause — missing condition, unclear instruction, silent error, edge case, etc.)

## 5. Propose a fix

Suggest one or more fixes, classified by approach:
- **Code fix** — change in hooks, handlers, or lib code
- **Instruction fix** — clearer or restructured CLAUDE.md instructions
- **Architecture fix** — behavior needs to move from one subsystem to another (e.g., from instruction-driven to hook-automated)
- **No fix needed** — the behavior is working as designed; the expectation was wrong

For each fix, note the specific file(s) to change and what the change would be.

## Output format

```
## Reflect: [short description of the issue]

**Expected:** [what should have happened]
**Classified as:** [hook-automated | instruction-driven | context-dependent | skill-triggered]

### Trace
[Step-by-step trace of the execution path, with file references]

### Gap found
[Where and why it broke]

### Recommended fix
[Concrete proposal with file paths and change description]
```
