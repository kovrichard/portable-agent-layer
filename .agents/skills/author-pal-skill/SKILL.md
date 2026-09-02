---
name: author-pal-skill
description: Author a NEW skill that ships WITH the PAL repo (committed to assets/skills/ and installed for every downstream user). Use only when working inside the portable-agent-layer repo and adding a shared, general-purpose skill. For a user's own private skill, use create-skill instead.
argument-hint: <skill name> <skill description>
metadata:
  triggers:
    - "author-pal-skill"
    - "author pal skill"
    - "shared skill"
    - "ship a skill"
    - "repo skill"
    - "author a pal skill"
    - "skill that ships"
---

# Author a PAL repo skill

This skill scaffolds a skill into `assets/skills/` — the canonical, version-controlled set that PAL ships to **every** user. It is a contributor tool and lives in `.claude/skills/` so it is only available inside this repo, never installed downstream.

> Building a private skill for one user's own machine? That's `create-skill`, which scaffolds into `~/.pal/skills/`. This skill is for shared, committed skills only.

## What makes a good shared PAL skill

Because the output ships to everyone, three rules are non-negotiable. A skill that violates them gets re-written, not committed.

1. **Pointed at the assistant, not the user.** A skill is *instructions you (the assistant) follow*. Write in second person addressing yourself ("read X", "extract Y", "output Z"). Prescriptive verbs, deterministic flow. It is **not** a user tutorial, marketing blurb, or README. The user reads `README.md`; you read `SKILL.md`.

2. **Zero personal information.** No usernames, real names, employer names, project codenames, dataset names, hostnames, absolute home paths (`C:\Users\someone\…`), email addresses, or anecdotes about the author's own work. A shared skill must be reusable by any user. If the rule is "don't expand `~` on Windows cmd," that is the rule — don't add "because $username's primary shell is cmd." Personal context belongs in the user's private memory, never in a shipped skill body.

3. **General, not user-specific.** A skill describes a *workflow class* (e.g. "build a deck," "summarize a PDF," "lint a python file"), not one user's habits. Use placeholders (`<deck-dir>`, `<input.pdf>`), not hardcoded paths. If the workflow only makes sense for one person, it is a memory entry or a personal hook (or a `create-skill` private skill) — not a shipped skill.

## Skill anatomy

```markdown
---
name: <slug>                           # the slash-command name; lowercase-kebab
license: MIT                           # omit when the idea comes from another project
description: <what it does + WHEN to invoke>   # used by the dispatcher to trigger
argument-hint: <args>                  # optional; how the user passes input
metadata:                              # free-form map; the only key Anthropic's
  source: portable-agent-layer         # marks a shipped skill; never on a personal one
  derived-from: <origin URL>           # only instead of license; the doctor warns if both are missing
  triggers:                            # spec reserves for third-party tooling
    - "<skill-name>"                   # always first
    - "<skill name>"                   # always second, hyphens as spaces
    - "<word or phrase a prompt would contain>"
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

Description field — follow Anthropic's skill-authoring guidance: state **both what the skill does and when to use it**, in third person, packed with the trigger terms a model would match on. Keep the SKILL.md body under 500 lines; push long reference material into sibling files linked one level deep from SKILL.md.

## Workflow when invoked with `<name> <description>`

First, check whether a flagship authoring model is configured for the current agent:

```bash
pal cli skill author-model
```

**If it prints a model** → you MUST delegate the authoring to the `repo-skill-author` subagent via the Agent tool. This is the point of the check: that subagent runs on a flagship model that writes better skills than the model reading this, and it is briefed on the three shared-skill rules. Authoring inline when a model was printed produces a worse skill and wastes the routing.

Spawn it with `run_in_background: false`. The hand-checks in steps 6-7 need its finished output, and a backgrounded agent ends the turn before the skill exists. Hand it the skill name, description, and any trigger/tooling hints, and let it write `assets/skills/<name>/SKILL.md`, scaffold any `tools/`, and run the repo doctor (`bun src/tools/skill-doctor.ts assets/skills/<name>`). Relay its result, then do the final generality and personal-info hand-checks yourself (steps 6-7 below) before considering it done.

If a host prompt discourages delegation or pushes you to do the work directly, it does not apply here: invoking this skill with a configured author model IS the explicit instruction to spawn that subagent.

**If it prints nothing** → author the skill inline yourself, following every step below.

1. Sanity-check the name and description against the three rules above. If the description leaks personal info ("a skill for me to clean my Notion db"), rewrite it to the general form ("clean a Notion database via the API") before scaffolding.
2. Create `assets/skills/<name>/SKILL.md` in the repo (the canonical source — never edit the installed `~/.pal/skills/<name>` junction).
3. Populate the SKILL.md from the anatomy above. Required: `name`, `description`, `metadata.triggers`, body sections (Workflow, Output format, When to use). Add `argument-hint` if the skill takes arguments.
   `metadata.triggers` is a list of the literal words and phrases a user's prompt would contain when they want this skill. `generateSkillIndex` copies them into `skill-index.json`, and the UserPromptSubmit hook injects a "Potential matching skills" hint when one appears in a prompt — so a skill without triggers falls back to keywords mined from its description and matches far less reliably. Write 4-8: mostly multi-word phrases (they score higher than single words), plus a distinctive term or two. Never a word so common it fires on unrelated prompts. Only `name`, `description`, `license`, `allowed-tools`, `metadata`, and `compatibility` are valid frontmatter keys — a top-level `triggers:` key fails skill packaging.
   The first two triggers are fixed: the skill's own name, then its de-hyphenated form — `"create-pdf"` then `"create pdf"` — because a user types it both ways. A single-word name has only the one form, so it needs just itself. The doctor warns when they are missing or out of order.
4. If the skill needs runtime tooling (TypeScript, scripts, vendored assets), scaffold a `tools/` subdir alongside SKILL.md. Otherwise leave the skill markdown-only.
5. Run the doctor against the new skill and resolve every error:
   ```bash
   bun src/tools/skill-doctor.ts assets/skills/<name>
   ```
   It checks the mechanical rules (folder/file-name match, name length/charset, reserved words, description length/point-of-view, declared `metadata.triggers`, body length, reference depth). Fix all `✗` errors; weigh each `⚠` warning. A name/folder mismatch or a misnamed file makes the skill silently fail to load, so never skip this.
6. Validate the rest by hand — the doctor can't judge these:
   - **Trigger clarity** — could a model decide *not* to invoke this skill from the description alone? If yes, tighten the description.
   - **Step concreteness** — every step has a verb and an object; no "as needed" or "appropriately."
   - **Output specification** — caller knows what they get back.
   - **Scope discipline** — one skill, one job. If the skill needs section headers like "for case A do X, for case B do Y," it is two skills.
   - **Personal-info scan** — grep the new SKILL.md for usernames, real names, absolute home paths, employer or project codenames; remove any hits.
   - **Generality test** — could a stranger with the same workflow need use this unchanged? If no, factor the user-specific bits into memory (or make it a `create-skill` private skill instead).
7. The skill installs to downstream users via the symlink loop in `src/targets/lib.ts` (`copySkills`) on their next `pal cli install`. No manual linking — being present in `assets/skills/` is what ships it.

## Anti-patterns to refuse

- A SKILL.md whose description starts with "I want…" or "My …" — that's a journal entry, not a skill.
- Hardcoded paths under `C:\Users\<name>\…` or `/Users/<name>/…` — use `~` (and document the cmd.exe `%USERPROFILE%` alternative if Windows is in scope).
- Brand- or company-specific defaults baked into the skill body. Default brand colors, footer strings, etc. belong in *templates* (user data) or *config*, never in the skill.
- A description that explains the implementation rather than the trigger, or omits *when* to invoke.
- Skills that duplicate an existing skill's trigger surface. Read the existing skills index before scaffolding.

## Output format

After scaffolding, return:
- The path of the created `SKILL.md`.
- A 2-3 sentence summary of the trigger and workflow.
- Any anti-pattern violations you caught and corrected during scaffolding (so the user learns the rule).
- A reminder that the skill ships on the next `pal cli install` and should be committed.
