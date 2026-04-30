---
name: create-skill
description: Scaffold a new PAL skill from a description. Use when creating a new skill, adding a capability, or building a custom command. Enforces general, assistant-facing, personally-clean skill writing.
argument-hint: <skill name> <skill description>
---

## What makes a good PAL skill

Before writing any skill, internalize these three rules. A skill that violates them gets re-written, not committed.

1. **Pointed at the assistant, not the user.** A skill is *instructions you (the assistant) follow*. Write in second person addressing yourself ("read X", "extract Y", "output Z"). Prescriptive verbs, deterministic flow. It is **not** a user tutorial, marketing blurb, or README. The user reads `README.md`; you read `SKILL.md`.

2. **Zero personal information.** No usernames, real names, employer names, project codenames, dataset names, hostnames, absolute home paths (`C:\Users\someone\…`), email addresses, or anecdotes about the author's own work. A skill must be reusable by any user. If the rule is "don't expand `~` on Windows cmd," that is the rule — don't add "because $username's primary shell is cmd." Personal context belongs in the user's private memory, never in the skill body.

3. **General, not user-specific.** A skill describes a *workflow class* (e.g. "build a deck," "summarize a PDF," "lint a python file"), not a single user's habits. Use placeholders (`<deck-dir>`, `<input.pdf>`), not hardcoded paths. If the workflow only makes sense for one person, it is a memory entry or a personal hook, not a skill.

## Skill anatomy

```markdown
---
name: <slug>                           # the slash-command name; lowercase-kebab
description: <one sentence trigger>    # WHEN to invoke (used by the dispatcher), not WHAT it does
argument-hint: <args>                  # optional; how the user passes input
---

## Overview / Workflow

Numbered steps the assistant follows on invocation. Each step is concrete:
read this file, run this command, ask this question, output this format.

## Output format

Exactly what the assistant returns to the user. Specify structure if the
caller will parse it; specify tone if the caller is a human.

## When to use / Do NOT use

Two short lists. The "do not" list disambiguates this skill from neighbours
that would otherwise also match the user's request.
```

## Workflow when the user invokes `/create-skill <name> <description>`

1. Sanity-check the name and description against the three rules above. If the description leaks personal info ("a skill for me to clean my Notion db"), rewrite it to the general form ("clean a Notion database via the API") before scaffolding.
2. Create `assets/skills/<name>/SKILL.md` in the repo (the canonical source). The installed copy at `~/.pal/skills/<name>/SKILL.md` may be a junction to this path — verify the user's setup before assuming.
3. Populate the SKILL.md from the anatomy above. Required fields: `name`, `description`, body sections (Workflow, Output format, When to use). Add `argument-hint` if the skill takes arguments.
4. If the skill needs runtime tooling (TypeScript, scripts, vendored assets), scaffold a `tools/` subdir alongside SKILL.md. Otherwise leave the skill markdown-only.
5. Validate before declaring done:
   - **Trigger clarity** — could a model decide *not* to invoke this skill from the description alone? If yes, tighten the description.
   - **Step concreteness** — every step has a verb and an object; no "as needed" or "appropriately."
   - **Output specification** — caller knows what they get back.
   - **Scope discipline** — one skill, one job. If the skill needs section headers like "for case A do X, for case B do Y," it is two skills.
   - **Personal-info scan** — grep the new SKILL.md for usernames, real names, absolute home paths, employer or project codenames; remove any hits.
   - **Generality test** — could a stranger with the same workflow need use this unchanged? If no, factor the user-specific bits into memory.

## Anti-patterns to refuse

- A SKILL.md whose description starts with "I want…" or "My …" — that's a journal entry, not a skill.
- Hardcoded paths under `C:\Users\<name>\…` or `/Users/<name>/…` — use `~` (and document the cmd.exe `%USERPROFILE%` alternative if Windows is in scope).
- Brand- or company-specific defaults baked into the skill body. Default brand colors, footer strings, etc. belong in *templates* (user data) or *config*, never in the skill.
- A description longer than ~30 words, or one that explains the implementation rather than the trigger.
- Skills that duplicate an existing skill's trigger surface. Read the existing skills index before scaffolding.

## Output format

After scaffolding, return:
- The path of the created `SKILL.md`.
- A 2-3 sentence summary of the trigger and workflow.
- Any anti-pattern violations you caught and corrected during scaffolding (so the user learns the rule).
