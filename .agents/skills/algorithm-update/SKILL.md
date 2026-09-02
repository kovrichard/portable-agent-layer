---
name: algorithm-update
description: Run a maintainer algorithm-update session — synthesize the collected Q2 ("smarter algorithm") reflections, cluster the recurring ideas, and fold approved changes into ALGORITHM.md. Use when the session reminder shows "Algorithm Review Due", or when asked to review/update the algorithm from reflections.
argument-hint: (none — reads ~/.pal reflections)
metadata:
  triggers:
    - "algorithm-update"
    - "algorithm update"
    - "algorithm review due"
    - "update the algorithm"
    - "fold reflections"
---

# Algorithm update session

This is a **repo-only, maintainer** workflow. It edits the algorithm *source* in this checkout (`assets/templates/PAL/ALGORITHM.md`), which is then committed and shipped to all users on the next release. It only makes sense inside the portable-agent-layer repo; it is never installed downstream.

## Workflow

1. **Synthesize** the reflection backlog since the last review:
   ```bash
   bun src/tools/agent/algorithm-synthesize.ts            # human report
   bun src/tools/agent/algorithm-synthesize.ts --json     # full membership, nothing capped
   ```
   Pass `--since <ISO>` to scope to a window if asked.

2. **Cluster semantically — do not trust the keyword buckets.** They are a coarse pre-sort biased to one model's wording. Read the report's **Unbucketed section in full** (that is where missed phrasings land) and the `--json` membership, then group by *actual meaning*, not shared keywords. Merge buckets that are the same idea worded differently.

3. **Rank candidate changes** by recurrence × breadth (how many distinct projects raised it). Surface the top recurring structural ideas as concrete proposed edits to ALGORITHM.md — a new gate, a phase step, a criterion rule, a capability pre-check.

4. **Present to the user and get per-change approval.** This is human-in-the-loop — never edit the algorithm unilaterally. For each approved change, edit the source:
   - Edit `assets/templates/PAL/ALGORITHM.md` (the canonical source).
   - Never edit `~/.pal/docs/ALGORITHM.md` — it is engine-managed and overwritten on `pal install`.
   - If the change adds a visible step, also add its output token to the Output Format block.

5. **Advance the review mark** so the cadence nudge resets and these reflections are not re-counted:
   ```bash
   bun .agents/skills/algorithm-update/tools/mark-reviewed.ts
   ```

6. **Close out:** remind the user to commit the ALGORITHM.md change (it ships to all users on the next release) and to run `pal cli install` to activate it in their own runtime now.

## Output format

Return:
- The ranked candidate changes considered, with recurrence counts.
- Which changes were applied to ALGORITHM.md and the exact edits.
- Confirmation the review mark was advanced (new timestamp).
- The commit + `pal cli install` reminder.

## Do NOT use

- Downstream / for a user's personal algorithm — this edits the shipped source. A personal algorithm overlay does not exist yet.
- To edit `~/.pal/docs/ALGORITHM.md` directly — always edit the repo source.
