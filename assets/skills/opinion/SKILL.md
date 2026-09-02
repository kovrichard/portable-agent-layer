---
name: opinion
description: "Opinion tracker for relationship notes. PROACTIVE: When the user confirms a preference ('yes exactly', 'keep doing that'), contradicts one ('no, don't do that', 'stop'), or you observe a recurring behavioral pattern — invoke this to update opinion confidence."
metadata:
  triggers:
    - "opinion"
    - "keep doing that"
    - "stop doing that"
    - "never do that"
    - "yes exactly"
    - "stop doing that"
    - "my preference"
---

# Opinion Tracker

Tool: `tools/opinion.ts`

Manage confidence-scored opinions about the user. Opinions are promoted from recurring relationship notes (the W/O/B observations captured at session end). This tool is the fast path to grow opinion confidence — relationship notes feed the slow path (+5% per reflect cycle), while explicit confirmations here jump +10%.

Opinions at ≥85% confidence are automatically injected into every session context.

## When to Use

**Proactively call this tool during conversations when:**

- The user **explicitly confirms** a preference → `--confirmation`
  - "yes, keep it short" → confirms concise preference
  - "exactly, that's how I want it" → confirms the approach you used
  - User accepts an unusual choice without pushback → implicit confirmation

- The user **explicitly contradicts** a preference → `--contradiction`
  - "no, I actually want more detail here" → contradicts concise preference
  - "stop doing X" → contradicts a tracked pattern

- You observe a **recurring behavioral pattern** → `--supporting`
  - User does the same thing for the 2nd+ time in a session
  - Pattern matches an existing tracked opinion

**Do NOT call when:**
- The observation is ephemeral or task-specific (not a general preference)
- You're unsure whether it's a real preference or a one-off request
- The opinion would be trivially obvious ("user wants correct code")

## Usage

```bash
# List all tracked opinions
bun opinion.ts list

# Show details for a specific opinion (fuzzy-matched)
bun opinion.ts show "keywords"

# Add a new opinion (starts at 60%)
bun opinion.ts add "statement" [--category workflow]

# Add evidence to an existing opinion
bun opinion.ts evidence "keywords" --supporting "why"      # +5%
bun opinion.ts evidence "keywords" --counter "why"         # -10%
bun opinion.ts evidence "keywords" --confirmation "why"    # +10%
bun opinion.ts evidence "keywords" --contradiction "why"   # -20%
```

## Categories

`communication` | `technical` | `workflow` | `general`

## Confidence Lifecycle

```
New opinion (add) → 60%
  ├── supporting evidence → +5% each
  ├── counter evidence → -10% each
  ├── explicit confirmation → +10% each
  ├── explicit contradiction → -20% each
  └── at ≥85% → auto-injected into session context
```

## Examples

```bash
# User says "yes keep it concise, I don't need long explanations"
bun opinion.ts evidence "concise responses" --confirmation "User explicitly said keep it concise"

# User asks for detailed explanation (contradicts concise preference)
bun opinion.ts evidence "concise responses" --contradiction "User requested detailed explanation for this topic"

# You notice user prefers iterative development for the 3rd time
bun opinion.ts evidence "iterative development" --supporting "User again chose incremental approach over big-bang change"

# New pattern: user always checks git status before committing
bun opinion.ts add "User checks git status before every commit" --category workflow
```
