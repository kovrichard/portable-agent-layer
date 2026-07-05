# Subagent authoring guide

The canonical rules for authoring a personal PAL subagent. Both the `create-subagent`
dispatcher and the delegated `subagent-author` subagent follow this file, so it is the
single source of truth for subagent quality and the exact frontmatter schema.

## What a subagent is

A subagent is a **separate agent you delegate a scoped task to** — a reviewer, a
researcher, a refactorer. It has its own system prompt, its own tool access, and
optionally its own model. It is not a skill (a workflow the current agent runs). If the
user wants "a thing the assistant does," that is `create-skill`; if they want "another
agent I can hand work to," that is this.

## One definition, every agent

A personal subagent is stored once as `~/.pal/agents/<name>.md` with **merged
multi-platform frontmatter**. On `pal cli subagent link <name>`, PAL splits it per
platform and writes a native file into each installed agent's agents directory. Global
fields (`name`, `description`) always ship; each platform block is un-indented into that
agent's frontmatter and the other blocks are stripped.

```markdown
---
name: <slug>                    # lowercase-kebab; MUST equal the file stem
description: "<what it does + WHEN to delegate to it>"
claude:
  tools: Read, Grep, Bash       # comma list; omit to inherit all tools
  model: fable                  # a model alias/id, or `inherit`
  skills:                       # OPTIONAL, Claude only — PRELOADS these skills
    - some-skill
opencode:
  mode: subagent                # required so opencode treats it as a delegate
  model: inherit
  permission:                   # per-capability: allow | ask | deny
    read: allow
    write: allow
    edit: allow
    bash: allow
cursor:
  model: inherit
  readonly: false
  is_background: false
copilot:
  model: inherit
  tools: read, edit             # comma list
---

<system prompt — second-person instructions to the subagent>
```

Only include the platform blocks that matter. A block you omit means that agent installs
with just `name` + `description` (a valid, minimal subagent).

## Per-platform field rules (verified, do not guess)

- **model** — `inherit` uses the caller's model. A flagship alias (`fable`, etc.) or a
  full model id pins it. Unknown values are a doctor warning, not an error, because model
  names drift.
- **tools** (Claude, Copilot) — a comma-separated allow-list. Omit to inherit all tools;
  do not write an empty `tools:`.
- **opencode** — set `mode: subagent`. Access is a `permission:` map (`read`, `write`,
  `edit`, `bash`, …) with values `allow` / `ask` / `deny`. opencode has **no** `tools`
  allow-list field.
- **skills** — **Claude Code only**, and it *preloads* skills into the subagent's context;
  it does not restrict them. opencode, Cursor, and Copilot have **no** `skills` frontmatter
  field — emitting one there is ignored. If a subagent should lean on specific skills on
  those agents, name them in the system prompt body instead.
- **cursor** — `readonly` and `is_background` are booleans (`true`/`false`).

## What makes a good subagent

1. **Pointed at the subagent, not the user.** The body is the subagent's system prompt —
   second-person instructions to *it* ("You review…", "Return…"). Not a tutorial.
2. **One job.** A subagent has a single role. "Reviews security AND writes migrations" is
   two subagents.
3. **A trigger in the description.** State *when to delegate* to it, in third person, with
   the terms a model would match on — the parent agent uses this to decide to hand off.
4. **Least privilege.** Grant only the tools/permissions the role needs. A read-only
   reviewer should not have write/bash.

## Hand-checks the doctor can't judge

- **Trigger clarity** — could the parent agent fail to delegate from the description alone?
- **Role discipline** — one job, one subagent.
- **Prompt concreteness** — the body tells the subagent exactly what to do and what to return.
- **Privilege fit** — tools/permissions match the role, nothing broader.
