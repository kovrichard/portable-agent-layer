---
name: first-principles
description: "Break down a problem to its fundamental constraints and build up a solution. Use when decomposing complexity, challenging assumptions, or finding root causes."
argument-hint: <problem>
metadata:
  source: portable-agent-layer
  derived-from: https://github.com/danielmiessler/LifeOS
  triggers:
    - "first-principles"
    - "first principles"
    - "root cause"
    - "break it down"
---

Break down $ARGUMENTS to fundamentals:

1. **State the problem** clearly in one sentence
2. **Identify assumptions** — what are we taking for granted?
3. **Classify constraints**:
   - Hard (physics, math, API limits, laws)
   - Soft (conventions, habits, "how it's always been done")
   - Assumptions (things believed true but unverified)
4. **Remove soft constraints** — what's possible without them?
5. **Build up** — from hard constraints only, what's the simplest solution?
6. **Compare** — how does the first-principles solution differ from the conventional one?
7. **Recommend** — which approach to take and why
