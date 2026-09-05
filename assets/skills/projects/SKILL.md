---
name: projects
license: MIT
description: "Project context management. PROACTIVE — use when the user references a project (by name or as \"this repo\", \"current work\"), asks to add/update/complete a project, says \"store under a named project\", \"track this\", \"what am I working on\", \"my projects\", \"my priorities\". Also triggered by ISC/ISA terminology — ISC stands for Ideal State Criteria, a project's verifiable done-conditions stored as `ISC-N:` lines in the Criteria section of its ISA.md spec. Phrases like \"ISC\", \"open/opening the ISC\", \"open ISCs\" (unfinished criteria), \"create/creating a ticket for a project\", \"new ticket\", or \"project ticket\" all map here: use `list-isc` to read them, `add-isc` to create one, `complete-isc`/`reopen-isc` to change status."
argument-hint: "[list | create | resume | add-next | add-blocker | add-decision | add-handoff | update-section | criteria | isa-init | complete | archive | pause]"
metadata:
  source: portable-agent-layer
  triggers:
    - "projects"
    - "isc"
    - "isa"
    - "my projects"
    - "what am i working on"
    - "my priorities"
    - "track this"
    - "resume the project"
    - "resume project"
    - "where are we"
    - "open ticket"
    - "open iscs"
    - "file ticket"
    - "file it as a ticket"
    - "file a ticket"
---

Manage the user's project registry. Each project lives at `~/.pal/memory/projects/{slug}/ISA.md`. Frontmatter holds operational state (next steps, blockers, handoff); the body holds ISA spec sections (Problem, Goal, Criteria, Context, Decisions, etc.). The Stop hook auto-touches `updated` whenever the cwd resolves into a registered project — just *being* in the project keeps it warm.

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
| `resume <name>` | Print the full project ISA — all frontmatter and body sections |
| `add-next <name> "text"` | Append a next step (array, instantly appendable) |
| `add-blocker <name> "text"` | Append a blocker (array, instantly appendable) |
| `add-decision <name> "decision" "rationale"` | Log a timestamped decision entry to the Decisions section |
| `add-handoff <name> "text"` | Overwrite the handoff field (single-value, replaces) |
| `rm-next \| rm-blocker <name> <index>` | Remove a next/blocker entry by zero-based index |
| `update-section <name> <section> "content"` | Set an ISA body section (problem, goal, criteria, vision, constraints, out_of_scope, context, decisions, changelog) |
| `criteria <name>` | Print the Criteria section (verifiable success conditions) |
| `isa-init <name>` | Mark a project as ISA-initialized |
| `complete <name>` / `archive <name>` / `pause <name>` / `unpause <name>` | Status transitions |
| `rm <name>` | Delete the project directory entirely |

## ISA Sections

The body of each ISA.md holds spec sections. Use `update-section` to set them:

| Section | Key | What goes here |
|---------|-----|---------------|
| Problem | `problem` | Why this project exists; the pain or gap being addressed |
| Goal | `goal` | What success looks like (may be bullet list) |
| Criteria | `criteria` | Open ISCs (Ideal State Criteria) — testable done conditions. Holds only the open set; completing an ISC moves it to the Changelog |
| Vision | `vision` | Long-horizon aspiration beyond the immediate goal |
| Constraints | `constraints` | Non-negotiable limits (budget, time, tech, compatibility) |
| Out of Scope | `out_of_scope` | What this project explicitly does NOT cover |
| Context | `context` | Stable facts / references (e.g. "reference impl lives at ~/pai") |
| Decisions | `decisions` | Auto-managed by `add-decision`; dated bullet list |
| Changelog | `changelog` | Archive of completed ISCs (`complete-isc` moves them here under a dated `### Archived` heading) plus any milestone notes |

**ISC archive model.** `complete-isc` does not just check a box — it moves the ISC line out of Criteria and into the Changelog archive, so Criteria always reflects exactly the open work and never bloats the context loaded at session start. `list-isc <name>` shows open ISCs by default; pass `--closed` (archived only) or `--all` (open + archived) to read finished ones. `reopen-isc` pulls an archived or retired ISC back into the open set. `edit-isc <name> <id> "new text"` rewrites an ISC's wording in place, keeping its id and state — use it to sharpen a vague criterion instead of closing and refiling. `retire-isc <name> <id> [--by <id>]` closes an ISC that stopped being valid: it files under a `### Retired` heading as `[~]` rather than claiming the work was done, and `--by` records the superseding ISC. A retired ISC counts as neither open nor done, is listed with `--retired`, and keeps its id reserved so no future ISC can reuse it. `prune-isc <name>` backfills legacy projects by sweeping any done ISCs still sitting in Criteria into the archive in one pass.

## Routing

| Intent | Action |
|--------|--------|
| "what am I working on", "my projects", "priorities" | `list` — summarize active and recently-touched projects |
| "tell me about <project>" | `resume <name>` — present current state, highlight blockers and next steps |
| "register this" / "track this" / cwd is unregistered work | `create` (default the name from cwd basename, confirm before writing) |
| "store under <project>: X" / "note on <project>: X" | Pick the field — durable reference → `update-section <slug> context "..."`, work item → `add-next`, obstacle → `add-blocker`. If unclear, ask. |
| "we decided X because Y" | `add-decision <name> "X" "Y"` |
| "handoff for <project>" / "next session pick up at X" | `add-handoff <name> "<text>"` |
| "set the goal for <project>" / "describe the problem" | `update-section <name> goal "..."` or `update-section <name> problem "..."` |
| "what are the criteria for <project>" / "what counts as done" | `criteria <name>` |
| "mark X complete" / "X is done" | `complete <name>` |
| "park <project>" / "pause <project>" | `pause <name>` |
| "archive <project>" | `archive <name>` |

## Proactive registration

When SessionStart context flags the current cwd as unregistered (e.g. `💡 cwd <path> is not yet registered; suggest registering if substantive work begins`) **and** the user starts substantive work (not just "hi"), surface the suggestion conversationally before the second tool call:

> "I see we're in `<basename>` and it's not registered yet — want me to add it as a project?"

- **Default name** = the FULL last path segment of cwd, lowercased. For `/repos/portable-agent-layer` → `portable-agent-layer`. Never split on `-`.
- **Confirm before creating.** Never auto-create without explicit user approval ("yes", "do it", "register").
- **Capture context in conversation.** If the user accepts but doesn't volunteer a goal, ask one short question, or infer from the last few messages and confirm.

### When NOT to suggest registration

- cwd has no project marker (`.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) — it's a notes folder, not a project.
- The user is clearly browsing or doing a one-off task.
- An ancestor of multiple registered projects is the cwd (e.g. a generic dev root) — that's browse mode by design.
- You're unsure. Err toward not registering.

## Append-as-you-go

When the user describes next steps, blockers, or decisions during normal work, invoke the relevant subcommand to keep state current — that's the dynamism this system is built for. Don't invoke for fleeting comments, hypotheticals, or things the user is just thinking through. Wait for a clear declarative ("let's add X", "Z is blocking us"), not a question or musing.

## Examples

**Storing a reference under an existing project**
```
User: "store under <project> that a reference implementation exists in this repo"
→ Identify the project from `list` (or by name)
→ Durable reference, not a task → update-section
→ bun ~/.pal/tools/project.ts update-section <slug> context "Reference implementation lives in this repo"
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

**Setting the goal and criteria**
```
User: "set the goal for pal to 'ship ISA support with full test coverage'"
→ bun ~/.pal/tools/project.ts update-section pal goal "ship ISA support with full test coverage"
```

**Completing a project**
```
User: "mark <project> as complete"
→ Confirm
→ bun ~/.pal/tools/project.ts complete <slug>
```

## Anti-patterns

- **Don't dump the full ISA.md.** Summarize. The user can ask for the raw payload.
- **Don't write without confirming the field choice on ambiguous "store" requests.** A context fact sticks forever; a next step implies follow-up — these are different commitments.
- **Don't edit ISA.md files directly.** Always use the CLI — it timestamps `updated` and keeps the schema valid.

## Rules

- Always check `list` (or `resume <name>`) before writing — match an existing project rather than spawning a near-duplicate.
- Slugs are `[a-z0-9_-]+`. Never rename a slug; if the display name needs to change, that's a code-side concern, not a slug change.
- The Stop hook handles `updated` automatically when cwd matches `path` — no manual touch needed just to mark a project alive.
- **Always announce a new ISC with the 🎟️ emoji — every single time, no exceptions.** Whenever you open an ISC (`add-isc`), report it back to the user on its own line prefixed with the ticket emoji and the ISC number, e.g. `🎟️ ISC #71 — <title>`. This holds in every response mode and context (ALGORITHM, NATIVE, or a bare reply); opening an ISC without the 🎟️ marker is a defect.
