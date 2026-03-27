---
name: telos
description: Personal and project context management. Use when discussing goals, projects, beliefs, challenges, identity, updating telos, life context, what am I working on, adding a project, changing a goal, priorities, what do I believe, current obstacles, mission, or strategies.
argument-hint: [area to view or update]
---

Manage the user's TELOS files — the persistent personal context that drives PAL.

## TELOS Files

All files live in `~/.pal/telos/`:

| File | Contains |
|------|----------|
| `GOALS.md` | Short/medium/long-term goals |
| `PROJECTS.md` | Active projects, status, priority |
| `BELIEFS.md` | Core principles and values |
| `CHALLENGES.md` | Current obstacles |
| `MISSION.md` | Purpose and direction |
| `STRATEGIES.md` | Approaches and plans |
| `IDEAS.md` | Ideas to explore |
| `LEARNED.md` | Key lessons |
| `MODELS.md` | Mental models |
| `NARRATIVES.md` | Narrative context |

## Reading

Read the file directly from `~/.pal/telos/` when the user asks about any area. Summarize what's relevant — don't dump the entire file unless asked.

## Updating

### General TELOS files (append)

For all files except PROJECTS.md — appends content, creates backup, logs the change:

```bash
bun ~/.pal/skills/telos/tools/update-telos.ts <FILE> "<content>" "<description>"
```

### Projects (upsert by ID)

For PROJECTS.md — upserts a row by the ID column. Replaces if the ID exists, appends if new:

```bash
bun ~/.pal/skills/telos/tools/update-projects.ts <id> "<row>" "<description>"
```

The ID is the first column of the table. Use short, lowercase, kebab-case slugs (e.g., `my-project`, `side-gig`).

## Routing

| Intent | Action |
|--------|--------|
| "what am I working on", "my projects", "priorities" | Read `PROJECTS.md`, summarize active work |
| "my goals", "what are my goals" | Read `GOALS.md`, present current state |
| "update goals/projects/beliefs/challenges" | Read the target file, discuss changes with user, then run update tool |
| "add a project", "new project" | Read `PROJECTS.md`, confirm with user, run update tool |
| "complete/remove a project" | Read `PROJECTS.md`, confirm with user, update status via tool |
| "what do I believe", "my principles" | Read `BELIEFS.md` |
| "current obstacles", "challenges" | Read `CHALLENGES.md` |
| "I learned something", "lesson" | Discuss, then append to `LEARNED.md` via tool |
| "I have an idea" | Discuss, then append to `IDEAS.md` via tool |
| General "update telos", "telos" | Ask which area to review/update |

## Examples

**Example 1: Checking projects**
```
User: "what am I working on?"
→ Read PROJECTS.md
→ Summarize active work by priority — don't list every column
→ Highlight status changes, blockers, what needs attention
```

**Example 2: Adding a project**
```
User: "add my new side project"
→ Ask: "What's the project name, status, and priority?"
→ User provides details
→ Show the row you'll add, confirm
→ Run: bun ~/.pal/skills/telos/tools/update-projects.ts side-project "| side-project | Side Project | In progress | Medium | Description |" "Added Side Project"
```

**Example 3: Updating a project**
```
User: "mark X as complete"
→ Read PROJECTS.md, find the entry and its ID
→ Show updated row, confirm
→ Run: bun ~/.pal/skills/telos/tools/update-projects.ts some-id "| some-id | Project Name | Complete | High | ... |" "Marked project as complete"
→ The existing row is replaced, not duplicated
```

**Example 4: Updating goals**
```
User: "I finished the migration, update my goals"
→ Read GOALS.md to see current state
→ Discuss what changed — what's done, what's next
→ Run tool with --id to update existing goal entry
→ Remind: CLAUDE.md regenerates next session
```

## Anti-patterns

- **Don't dump raw file contents.** Summarize what's relevant to the user's question. They can ask for the full file if needed.
- **Don't update without confirming.** Always show what you'll change and get a "yes" before running the tool.
- **Don't create new TELOS files.** Only the 10 listed files are valid. If something doesn't fit, suggest the closest match.
- **Don't mix TELOS with identity.** AI/principal identity lives in `pal-settings.json`, not TELOS. TELOS is personal context — goals, beliefs, projects.
- **Don't reference stale data.** If TELOS was loaded earlier in the session via context routing, re-read the file before updating — it may have changed.

## Rules

- **Always read the file first** before making changes — match the existing format exactly
- **Confirm changes** with the user before running the update tool
- **Always use the tool** for writes — never edit TELOS files directly
- CLAUDE.md auto-regenerates from these files on next session start
