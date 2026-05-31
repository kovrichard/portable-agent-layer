---
name: create-skill
description: Create a new personal skill for this user, scaffolded into their own ~/.pal/skills/ and linked into every installed agent. Use when the user asks to create a skill, add a capability, build a custom command, or "make a skill that…".
argument-hint: <skill name> <skill description>
---

# Create a personal skill

This scaffolds a personal skill into the user's own `~/.pal/skills/<name>/` and links it into every installed agent so it is immediately discoverable.

## What makes a good skill

1. **Pointed at the assistant, not the user.** A skill is *instructions you (the assistant) follow*. Write in second person addressing yourself ("read X", "run Y", "output Z"). Prescriptive verbs, deterministic flow — not a tutorial or marketing blurb.

2. **One skill, one job.** A skill describes a single workflow. If it needs branches like "for case A do X, for case B do Y," it is two skills.

3. **Concise and concrete.** Assume the model is already smart — only add what it doesn't already know. Every step has a verb and an object; no "as needed" or "appropriately." Keep the SKILL.md body well under 500 lines; push long reference material into sibling files linked one level deep.

A personal skill **may** contain this user's own context — their paths, project names, preferences, conventions. That is the point of a personal skill.

## Skill anatomy

```markdown
---
name: <slug>                           # the slash-command name; lowercase-kebab
description: <what it does + WHEN to invoke>   # the dispatcher matches on this
argument-hint: <args>                  # optional; how the user passes input
---

## Overview / Workflow

Numbered, concrete steps the assistant follows on invocation.

## Output format

Exactly what the assistant returns — structure if it will be parsed, tone if a human reads it.

## When to use / Do NOT use

Two short lists; the "do not" list disambiguates this skill from neighbours.
```

The `description` should state **both what the skill does and when to invoke it**, in third person, with the trigger terms a model would match on. A vague description ("helps with documents") will not trigger reliably.

## Workflow when invoked with `<name> <description>`

1. Validate the name: lowercase-kebab, no spaces, not colliding with an existing skill (check `~/.pal/skills/` and the active skill list).
2. Confirm the trigger with the user if the description is ambiguous about *when* the skill should fire.
3. Create the directory and SKILL.md at the user's PAL home:
   ```bash
   mkdir -p ~/.pal/skills/<name>
   ```
   Write `~/.pal/skills/<name>/SKILL.md` populated from the anatomy above (frontmatter + Workflow + Output format + When to use).
4. If the skill needs runtime tooling, scaffold a `tools/` subdir alongside SKILL.md and write the scripts there.
5. Link the new skill into every installed agent so it is discoverable:
   ```bash
   pal cli skill link <name>
   ```
   This creates the per-skill discovery symlink in each installed agent's skills directory (Claude Code, Cursor, Copilot, Codex); opencode discovers it automatically via `~/.pal/skills/`.
6. Run the doctor and resolve every error it reports:
   ```bash
   pal cli skill doctor <name>
   ```
   It checks the mechanical rules (folder/file-name match, name length/charset, description length, point-of-view, body length, reference depth). Fix all `✗` errors; weigh each `⚠` warning. A name/folder mismatch or a misnamed file makes the skill silently fail to load, so never skip this.
7. Validate the rest by hand — the doctor can't judge these:
   - **Trigger clarity** — could a model decide *not* to invoke this from the description alone? If so, tighten it.
   - **Step concreteness** — every step has a verb and an object.
   - **Output specification** — the caller knows what they get back.
   - **Scope discipline** — one skill, one job.

## Output format

After scaffolding, return:
- The path of the created `SKILL.md` (under `~/.pal/skills/<name>/`).
- The agents it was linked into (from the `pal cli skill link` output).
- A 2-3 sentence summary of the trigger and workflow.
- How to invoke it (its `/<name>` slash command or trigger phrase).
