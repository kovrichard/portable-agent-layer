---
name: telos
description: "Personal context management. Use when discussing goals, beliefs, challenges, identity, updating telos, life context, changing a goal, what do I believe, current obstacles, mission, or strategies."
argument-hint: [area to view or update]
metadata:
  source: portable-agent-layer
  triggers:
    - "telos"
    - "my goals"
    - "my beliefs"
    - "my mission"
    - "life context"
    - "current challenges"
    - "what do i believe"
    - "my strategies"
---

Manage the user's TELOS files — from Greek τέλος (télos), meaning end/purpose/goal. The persistent personal context that orients PAL around who the user is and what they're working toward.

## TELOS Files

All files live in `~/.pal/telos/`:

| File | Contains |
|------|----------|
| `GOALS.md` | Short/medium/long-term goals |
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

Appends content, creates backup, logs the change:

```bash
bun ~/.pal/skills/telos/tools/update-telos.ts <FILE> "<content>" "<description>"
```

## Routing

| Intent | Action |
|--------|--------|
| "my goals", "what are my goals" | Read `GOALS.md`, present current state |
| "update goals/beliefs/challenges" | Read the target file, discuss changes with user, then run update tool |
| "what do I believe", "my principles" | Read `BELIEFS.md` |
| "current obstacles", "challenges" | Read `CHALLENGES.md` |
| "I learned something", "lesson" | Discuss, then append to `LEARNED.md` via tool |
| "I have an idea" | Discuss, then append to `IDEAS.md` via tool |
| General "update telos", "telos" | Ask which area to review/update |

## Examples

**Updating goals**
```
User: "I finished the migration, update my goals"
→ Read GOALS.md to see current state
→ Discuss what changed — what's done, what's next
→ Run tool with updated content
→ Remind: CLAUDE.md regenerates next session
```

## Anti-patterns

- **Don't dump raw file contents.** Summarize what's relevant to the user's question. They can ask for the full file if needed.
- **Don't update without confirming.** Always show what you'll change and get a "yes" before running the tool.
- **Don't create new TELOS files.** Only the 9 listed files are valid. If something doesn't fit, suggest the closest match.
- **Don't mix TELOS with identity.** AI/principal identity lives in `pal-settings.json`, not TELOS. TELOS is personal context — goals, beliefs, challenges.
- **Don't reference stale data.** If TELOS was loaded earlier in the session via context routing, re-read the file before updating — it may have changed.

## Rules

- **Always read the file first** before making changes — match the existing format exactly
- **Confirm changes** with the user before running the update tool
- **Always use the tool** for writes — never edit TELOS files directly
- CLAUDE.md auto-regenerates from these files on next session start
