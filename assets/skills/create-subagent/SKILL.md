---
name: create-subagent
description: "Create a user-scoped subagent for every installed agent (Claude Code, opencode, Cursor, Copilot) from one merged definition, then install and run the doctor on it. Use when the user asks to create a subagent, add a custom agent, delegate a role to a specialized agent, or \"make a subagent that…\"."
argument-hint: <subagent name> <what it does + when to delegate>
metadata:
  triggers:
    - "create a subagent"
    - "new subagent"
    - "make a subagent"
    - "custom agent"
    - "delegate to an agent"
---

# Create a personal subagent

This authors a personal subagent into the user's own `~/.pal/agents/<name>.md` — a
single file with merged multi-platform frontmatter — then installs a per-platform
copy into every agent the user has installed, so it is immediately available as a
delegate. It does not touch the subagents PAL ships (those live in the repo).

The per-platform frontmatter schema and every field rule live in one place — read it
before writing anything:

```bash
cat ~/.pal/skills/create-subagent/authoring-guide.md
```

## Workflow when invoked with `<name> <description>`

1. Validate the name: lowercase-kebab, no spaces. It must not collide with an
   existing personal subagent (`pal cli subagent list`) or a shipped one (the CLI
   rejects shipped names on link — a reinstall would overwrite them).
2. Interview the user for what the description leaves unspecified. Ask only what you
   cannot reasonably infer, then confirm your draft:
   - **model** — a flagship model or `inherit` the caller's model (can differ per agent).
   - **tools** — which tools it may use (a comma list for Claude/Copilot; a permission
     map for opencode). Default: inherit all tools.
   - **skills** — skills to PRELOAD. Claude Code only; the other agents have no such
     field (see the guide). Record intended skills in the body for the others.
   - **system prompt** — the role and behavior. Draft it and confirm with the user.
3. Check whether a flagship authoring model is configured for the current agent:
   ```bash
   pal cli subagent author-model
   ```
4. **If it prints a model** → delegate the authoring to the `subagent-author` subagent
   (preconfigured to run on that flagship model). Hand it the name, description, and
   interview answers; let it write `~/.pal/agents/<name>.md`, run `pal cli subagent
   link`, and run the doctor. Relay its result.
5. **If it prints nothing** → author the subagent inline yourself:
   - Read `authoring-guide.md` (above) and follow the merged frontmatter schema.
   - Write `~/.pal/agents/<name>.md` (create `~/.pal/agents/` if it is missing).
   - Install it into every installed agent:
     ```bash
     pal cli subagent link <name>
     ```
   - Run the doctor and fix every `✗` error; weigh each `⚠`:
     ```bash
     pal cli subagent doctor <name>
     ```

Either path: if only some agents are installed, `pal cli subagent link` writes only to
those — re-run it after installing another agent to propagate the subagent there.

## Output format

After installing, return:
- The path of the created definition (`~/.pal/agents/<name>.md`).
- The agents it was installed into (from the `pal cli subagent link` output).
- The doctor's final result (errors resolved).
- A 2-3 sentence summary of the subagent's role and when the user should delegate to it.

## When to use / Do NOT use

- **Use** when the user wants a reusable, specialized *agent* they delegate work to,
  shared across their installed agents.
- **Do NOT use** for a personal *skill* — a workflow the current agent runs itself.
  That is `create-skill`. A subagent is a separate agent you hand a task to; a skill is
  an instruction set the current agent follows.
