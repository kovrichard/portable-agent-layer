# Skill authoring guide

The canonical rules for authoring a personal PAL skill. Both the `create-skill`
dispatcher and the delegated `skill-author` subagent follow this file, so it is
the single source of truth for skill quality.

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

## Hand-checks the doctor can't judge

- **Trigger clarity** — could a model decide *not* to invoke this from the description alone? If so, tighten it.
- **Step concreteness** — every step has a verb and an object.
- **Output specification** — the caller knows what they get back.
- **Scope discipline** — one skill, one job.
