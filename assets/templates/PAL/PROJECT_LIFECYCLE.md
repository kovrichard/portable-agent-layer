# Project Lifecycle

You (the AI) own the project lifecycle. Project state lives in `~/.pal/memory/state/progress/{slug}.json`, one file per project, managed via `bun ~/.pal/tools/project.ts`. Active projects are auto-injected into every SessionStart context regardless of cwd.

## When to invoke the CLI

**Proactive registration.** When SessionStart context says `💡 cwd <path> is not yet registered; suggest registering if substantive work begins`, AND the user starts substantive work (not just "hi"), surface the suggestion conversationally before the second tool call: *"I see we're in `<basename>` and it's not registered yet — want me to add it as a project?"*

- **Default name** = the FULL last path segment of `cwd`, lowercased. For `/repos/portable-agent-layer` the default is `portable-agent-layer`. Never split on `-`.
- **Confirm before creating.** Never auto-create without explicit user approval ("yes", "do it", "register").
- **Capture objectives in conversation.** If the user accepts but doesn't volunteer objectives, ask one short question; or infer from the last few messages and confirm.

**Append as you go.** When the user describes plans, blockers, or decisions during normal work, invoke the relevant subcommand to keep state current — that's the dynamism this system is built for.

| user says | you call |
|---|---|
| "let's also add X" / "we should handle Y next" | `add-next <name> "..."` |
| "we're blocked on Z" / "Z is blocking this" | `add-blocker <name> "..."` |
| "the objective here is to ship X by Y" | `add-objective <name> "..."` |
| "the API base is at Z" / "tech stack is Bun + TS" — stable, reference-flavored facts | `add-fact <name> "..."` |
| "we decided to use A because B" | `add-decision <name> "A" "B"` |
| "let's pause this" / "shelve it" | `pause <name>` |
| "we shipped" / "this is done" | `complete <name>` |

**Don't** invoke for fleeting comments, hypotheticals, or things the user is just thinking through. Wait for a clear declarative ("let's add X", "Z is blocking us"), not a question or musing.

## When NOT to suggest registration

- cwd has no project marker (`.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) — it's a notes folder, not a project.
- The user is clearly browsing or doing a one-off task.
- An ancestor of multiple registered projects is the cwd (e.g. `~/Development/git/`) — that's browse mode by design.
- You're unsure. Err toward not registering.

## CLI cheat sheet

```
list                                          show all projects
create [name] [--path PATH] [--objectives X]  register (defaults: name=basename(cwd), path=cwd)
resume <name>                                 print full project JSON
complete | archive | pause | unpause <name>   change status
add-fact | add-objective | add-next | add-blocker <name> "text"
add-decision <name> "decision" "rationale"
add-handoff <name> "text"
rm-fact | rm-objective | rm-next | rm-blocker <name> <index>
rm <name>                                     delete the project file (rare; prefer archive)
```

The Stop hook auto-touches `updated` (and optionally writes a `handoff`) whenever cwd resolves to an active project — you don't need to refresh timestamps manually.
