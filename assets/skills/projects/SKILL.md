---
name: projects
description: Project context management. PROACTIVE — use when the user references a project (by name or as "this repo", "current work"), asks to add/update/complete a project, says "store under <project>", "track this", "what am I working on", "my projects", "my priorities".
argument-hint: [list | create | resume | add-fact | add-objective | add-next | add-blocker | add-decision | add-handoff | complete | archive | pause]
---

Manage the user's project registry. Each project has its own state file at `~/.pal/memory/state/progress/{slug}.json`. The Stop hook auto-touches `updated` whenever the cwd resolves into a registered project — so just *being* in the project keeps it warm.

## CLI

All operations go through the canonical CLI:

```bash
bun ~/.pal/tools/project.ts <command> [args]
```

Output is JSON.

| Command | Purpose |
|---------|---------|
| `list` | All registered projects with status, path, updated, stale flag, and counts |
| `create [name] [--path PATH] [--objectives "a;b;c"]` | Register a project. Defaults: name=basename(cwd), path=cwd. Slug must be `[a-z0-9_-]+` |
| `resume <name>` | Print the full project JSON — facts, objectives, next steps, blockers, decisions, handoff |
| `add-fact <name> "text"` | Append a stable fact / reference (e.g., "reference impl lives in this repo") |
| `add-objective <name> "text"` | Append an objective |
| `add-next <name> "text"` | Append a next step |
| `add-blocker <name> "text"` | Append a blocker |
| `add-decision <name> "decision" "rationale"` | Log a timestamped decision |
| `add-handoff <name> "text"` | Overwrite the handoff field (single-value) |
| `rm-fact \| rm-objective \| rm-next \| rm-blocker <name> <index>` | Remove an entry by zero-based index |
| `complete <name>` / `archive <name>` / `pause <name>` / `unpause <name>` | Status transitions |
| `rm <name>` | Delete the project state file entirely |

## Routing

| Intent | Action |
|--------|--------|
| "what am I working on", "my projects", "priorities" | `list` — summarize active and recently-touched projects |
| "tell me about <project>" | `resume <name>` — present current state, highlight blockers and next steps |
| "register this" / "track this" / cwd is unregistered work | `create` (default the name from cwd basename, confirm before writing) |
| "store under <project>: X" / "note on <project>: X" | Pick the field — durable reference → `add-fact`, work item → `add-next`, obstacle → `add-blocker`. If unclear, ask. |
| "we decided X because Y" | `add-decision <name> "X" "Y"` |
| "handoff for <project>" / "next session pick up at X" | `add-handoff <name> "<text>"` |
| "mark X complete" / "X is done" | `complete <name>` |
| "park <project>" / "pause <project>" | `pause <name>` |
| "archive <project>" | `archive <name>` |

## Proactive registration

When SessionStart context flags the current cwd as unregistered (e.g. `💡 cwd <path> is not yet registered; suggest registering if substantive work begins`) **and** the user starts substantive work (not just "hi"), surface the suggestion conversationally before the second tool call:

> "I see we're in `<basename>` and it's not registered yet — want me to add it as a project?"

- **Default name** = the FULL last path segment of cwd, lowercased. For `/repos/portable-agent-layer` → `portable-agent-layer`. Never split on `-`.
- **Confirm before creating.** Never auto-create without explicit user approval ("yes", "do it", "register").
- **Capture objectives in conversation.** If the user accepts but doesn't volunteer objectives, ask one short question, or infer from the last few messages and confirm.

### When NOT to suggest registration

- cwd has no project marker (`.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) — it's a notes folder, not a project.
- The user is clearly browsing or doing a one-off task.
- An ancestor of multiple registered projects is the cwd (e.g. a generic dev root) — that's browse mode by design.
- You're unsure. Err toward not registering.

## Append-as-you-go

When the user describes plans, blockers, or decisions during normal work, invoke the relevant subcommand to keep state current — that's the dynamism this system is built for. Don't invoke for fleeting comments, hypotheticals, or things the user is just thinking through. Wait for a clear declarative ("let's add X", "Z is blocking us"), not a question or musing.

## Examples

**Storing a reference under an existing project**
```
User: "store under <project> that a reference implementation exists in this repo"
→ Identify the project from `list` (or by name)
→ Durable reference, not a task → add-fact
→ bun ~/.pal/tools/project.ts add-fact <slug> "Reference implementation lives in this repo"
```

**Registering the current repo**
```
User: "track this project"
→ Default name from cwd basename, confirm with user
→ bun ~/.pal/tools/project.ts create --path "$(pwd)" --objectives "first objective; second objective"
```

**Logging a decision**
```
User: "we decided <decision> because <reason>"
→ bun ~/.pal/tools/project.ts add-decision <slug> "<decision>" "<reason>"
```

**Completing a project**
```
User: "mark <project> as complete"
→ Confirm
→ bun ~/.pal/tools/project.ts complete <slug>
```

## Anti-patterns

- **Don't dump the full JSON.** Summarize. The user can ask for the raw payload.
- **Don't write without confirming the field choice on ambiguous "store" requests.** A "fact" sticks forever; a "next step" implies follow-up — these are different commitments.
- **Don't edit the JSON files directly.** Always use the CLI — it timestamps `updated` and keeps the schema valid.
- **Don't re-introduce `~/.pal/telos/PROJECTS.md`.** That file and its `update-projects.ts` tool are deprecated. The legacy `telos` skill carries a deprecation notice for this reason.
- **Don't confuse `add-fact` with the `telos` skill's `LEARNED.md` or `IDEAS.md`.** Project facts are scoped to one project; TELOS lessons are cross-cutting.

## Rules

- Always check `list` (or `resume <name>`) before writing — match an existing project rather than spawning a near-duplicate.
- Slugs are `[a-z0-9_-]+`. Never rename a slug; if the display name needs to change, that's a code-side concern, not a slug change.
- The Stop hook handles `updated` automatically when cwd matches `path` — no manual touch needed just to mark a project alive.
