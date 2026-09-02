---
name: pal-reflect
license: MIT
description: "Run relationship reflect — promote recurring behavioral observations into tracked opinions. Use when relationship reflect is due, or when the user asks to review what patterns have been observed."
argument-hint: [optional: --dry-run to preview without writing]
metadata:
  source: portable-agent-layer
  triggers:
    - "pal-reflect"
    - "pal reflect"
    - "relationship reflect"
    - "behavioral observations"
    - "tracked opinions"
    - "patterns observed"
---

When `/pal-reflect` is invoked (by you in response to a nudge, or by the user directly):

## 1. Run the reflect tool

```bash
bun run tool:reflect
```

If the user passed `--dry-run`, append it: `bun run tool:reflect -- --dry-run`

## 2. Parse and present the output

Read the console output and present a concise summary:

**If opinions were promoted or strengthened:**
```
Reflect complete — here's what changed:

NEW opinions (confidence seeded from recurring observations):
- [statement] (XX%)

STRENGTHENED opinions (evidence accumulated):
- [statement]: XX% → YY%
```

**If nothing changed:**
```
Reflect complete — no patterns strong enough yet.
[N] observations loaded. An opinion promotes when the same pattern appears 2+ times.
Most recent observations:
- [list up to 3 recent O notes]
```

## 3. Offer a follow-up

After showing results, say:
> "Want to review the full opinions list, or is there a specific pattern you'd like to reinforce or correct?"

If the user confirms or corrects something, use the opinion tool:
```bash
# Confirmed
bun ~/.pal/skills/opinion/tools/opinion.ts evidence "keywords" --confirmation "what they confirmed"

# Corrected
bun ~/.pal/skills/opinion/tools/opinion.ts evidence "keywords" --contradiction "what they corrected"
```
