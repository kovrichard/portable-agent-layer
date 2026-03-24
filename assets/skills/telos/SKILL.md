---
name: telos
description: Personal and project context management. USE WHEN goals, projects, beliefs, challenges, identity, update telos, life context, what am I working on, add a project, change a goal, my priorities, what do I believe, current obstacles, mission, strategies
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
| `IDENTITY.md` | AI identity and personality |
| `MISSION.md` | Purpose and direction |
| `STRATEGIES.md` | Approaches and plans |
| `IDEAS.md` | Ideas to explore |
| `LEARNED.md` | Key lessons |
| `MODELS.md` | Mental models |
| `NARRATIVES.md` | Narrative context |

## Routing

| Intent | Action |
|--------|--------|
| "what am I working on", "my projects", "priorities" | Read `PROJECTS.md`, summarize active work |
| "my goals", "what are my goals" | Read `GOALS.md`, present current state |
| "update goals/projects/beliefs/challenges" | Read the target file, discuss changes with user, apply edits |
| "add a project", "new project" | Read `PROJECTS.md`, add entry following existing format |
| "remove/complete a project" | Read `PROJECTS.md`, update status or remove |
| "what do I believe", "my principles" | Read `BELIEFS.md` |
| "current obstacles", "challenges" | Read `CHALLENGES.md` |
| General "update telos", "telos" | Ask which area to review/update |

## Rules

- **Always read the file first** before making any changes — match the existing format exactly
- **Confirm changes** with the user before writing — show what you'll change
- **Never overwrite** — only edit specific sections
- After editing, remind the user that CLAUDE.md auto-regenerates from these files on next session start
