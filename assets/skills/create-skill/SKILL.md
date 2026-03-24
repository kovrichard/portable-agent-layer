---
name: create-skill
description: Scaffold a new PAL skill from a description. Use when creating a new skill, adding a capability, or building a custom command.
argument-hint: <skill description>
---

When the user invokes /create-skill <name> <description>:

1. Create a new markdown file in the skills/ directory
2. Use this template:

```markdown
---
name: <name>
description: <one-line description>
---

When the user invokes /<name> <args>:

1. <step>
2. <step>
3. <step>

Output format:
- <format specification>
```

3. Validate the skill has:
   - Clear trigger (when to invoke)
   - Specific steps (not vague)
   - Defined output format
   - Reasonable scope (one skill, one job)
