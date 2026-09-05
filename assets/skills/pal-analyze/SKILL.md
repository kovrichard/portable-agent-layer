---
name: pal-analyze
license: MIT
description: "Run learning analysis — surface rating trends, recurring failure patterns, and graduation candidates. Use when learning analysis is due, or when the user asks about performance patterns, low ratings, or what to improve."
argument-hint: "[optional: --actionable for AI-generated recommendations]"
metadata:
  source: portable-agent-layer
  triggers:
    - "pal-analyze"
    - "pal analyze"
    - "learning analysis"
    - "rating trends"
    - "failure patterns"
    - "low ratings"
    - "what to improve"
---

When `/pal-analyze` is invoked (by you in response to a nudge, or by the user directly):

## 1. Run the analyze tool

```bash
pal cli analyze
```

If the user passed `--actionable` or wants recommendations, append it: `pal cli analyze --actionable`

## 2. Parse and present the output

Read the console output and summarize the key signals. Focus on what's actionable, not exhaustive lists:

**Ratings section:**
- Lead with the average and trend direction
- Call out any striking low-rating clusters (e.g. "47 low ratings, mostly around scope drift corrections")

**Graduation candidates:**
- Name the top 1-3 patterns ready to crystallize
- Suggest the wisdom domain they'd live in

**Emerging patterns:**
- Name any 2-occurrence patterns worth watching

Format example:
```
Analysis complete:

Ratings: X.X/10 avg | N low (≤4) | N high (≥7)
Top low-rating context: "[cluster description]"

Ready to graduate (3+ occurrences):
- "[pattern]" → suggest adding to wisdom/[domain].md

Emerging (2 occurrences — one more to graduate):
- "[pattern]"
```

## 3. Offer to act

After showing results, ask:
> "Want to crystallize any of these into a wisdom frame, or dig into the low-rating clusters?"

If yes to crystallizing:
```bash
bun ~/.pal/tools/wisdom-frame.ts --domain <domain> --observation "<principle>"
```
