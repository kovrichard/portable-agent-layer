---
name: telos
description: Personal and project context management. Use when discussing goals, projects, beliefs, challenges, identity, updating telos, life context, what am I working on, adding a project, changing a goal, priorities, what do I believe, current obstacles, mission, or strategies.
argument-hint: [area to view or update]
---

Manage the user's TELOS files — the persistent personal context that drives PAL.

## TELOS Files

All files live in `~/.agents/PAL/telos/`:

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

Read the file directly from `~/.agents/PAL/telos/` when the user asks about any area.

## Updating

Use the update tool for all changes. It validates the file, creates a backup, appends content, and logs the change:

```bash
bun ~/.agents/skills/telos/tools/update-telos.ts <FILE> "<content>" "<description>"
```

**Example:**
```bash
bun ~/.agents/skills/telos/tools/update-telos.ts PROJECTS.md "| New Project | In progress | High | Description |" "Added New Project"
```

## Routing

| Intent | Action |
|--------|--------|
| "what am I working on", "my projects", "priorities" | Read `PROJECTS.md`, summarize |
| "my goals", "what are my goals" | Read `GOALS.md`, present current state |
| "update goals/projects/beliefs/challenges" | Read the target file, discuss changes with user, then run update tool |
| "add a project", "new project" | Read `PROJECTS.md`, confirm with user, run update tool |
| "what do I believe", "my principles" | Read `BELIEFS.md` |
| "current obstacles", "challenges" | Read `CHALLENGES.md` |
| General "update telos", "telos" | Ask which area to review/update |

## Rules

- **Always read the file first** before making changes — match the existing format exactly
- **Confirm changes** with the user before running the update tool
- **Always use the tool** for writes — never edit TELOS files directly
