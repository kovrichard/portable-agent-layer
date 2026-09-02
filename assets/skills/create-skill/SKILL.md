---
name: create-skill
description: "Create a new personal skill for this user, scaffolded into their own ~/.pal/skills/ and linked into every installed agent. Use when the user asks to create a skill, add a capability, build a custom command, or \"make a skill that…\"."
argument-hint: <skill name> <skill description>
metadata:
  triggers:
    - "create-skill"
    - "create skill"
    - "create a skill"
    - "new skill"
    - "make a skill"
    - "add a skill"
    - "custom command"
    - "personal skill"
---

# Create a personal skill

This scaffolds a personal skill into the user's own `~/.pal/skills/<name>/` and links it into every installed agent so it is immediately discoverable.

The quality rules and the exact skill anatomy live in one place — read them before writing anything:

```bash
cat ~/.pal/skills/create-skill/authoring-guide.md
```

## Workflow when invoked with `<name> <description>`

1. Check whether a flagship authoring model is configured for the current agent:
   ```bash
   pal cli skill author-model
   ```
2. **If it prints a model** → delegate the authoring to the `skill-author` subagent. That subagent is preconfigured to run on that flagship model; hand it the skill name, description, and any trigger/tooling hints, and let it write the SKILL.md, scaffold tools, run `pal cli skill link`, and run the doctor. Relay its result.
3. **If it prints nothing** → author the skill inline yourself:
   - Read `authoring-guide.md` (above) and follow its anatomy.
   - `mkdir -p ~/.pal/skills/<name>` and write `~/.pal/skills/<name>/SKILL.md`.
   - If the skill needs runtime tooling, scaffold a `tools/` subdir and write the scripts there.
   - Link it into every installed agent: `pal cli skill link <name>`.
   - Run `pal cli skill doctor <name>` and fix every `✗`; weigh each `⚠`.
   - Hand-check the items the doctor can't judge (see the guide's final section).

Either path: validate the name first (lowercase-kebab, no spaces, not colliding with an existing skill in `~/.pal/skills/` or the active skill list), and confirm the trigger with the user if the description is ambiguous about *when* the skill should fire.

## Output format

After scaffolding, return:
- The path of the created `SKILL.md` (under `~/.pal/skills/<name>/`).
- The agents it was linked into (from the `pal cli skill link` output).
- A 2-3 sentence summary of the trigger and workflow.
- How to invoke it (its `/<name>` slash command or trigger phrase).
