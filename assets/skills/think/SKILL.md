---
name: think
description: "Thinking mode router — selects the right analytical approach for a question. Use when thinking through a problem, analyzing deeply, brainstorming ideas, debating options, decomposing to root cause, challenging assumptions, or exploring from multiple perspectives."
argument-hint: <question or topic>
metadata:
  triggers:
    - "think through"
    - "brainstorm"
    - "analyze deeply"
    - "think about this"
    - "mental model"
---

Route $ARGUMENTS to the right thinking mode based on intent. Detect the mode from context — do NOT ask.

## Routing

| Intent signals | Mode | How to invoke |
|---------------|------|---------------|
| decompose, root cause, fundamental, challenge assumptions, first principles, why is X happening | **First Principles** | Use the Skill tool to invoke `first-principles` with $ARGUMENTS |
| debate, weigh options, multiple viewpoints, perspectives, deliberate, should I, which is better | **Council** | Use the Skill tool to invoke `council` with $ARGUMENTS |
| brainstorm, creative, divergent, ideas, what if, possibilities, how could we, make it better | **Creative** | Follow the Creative steps below with $ARGUMENTS |
| think through, analyze, explore deeply, examine from angles, tradeoffs, what are the implications | **Deep Analysis** | Follow the Deep Analysis steps below with $ARGUMENTS |

If intent is ambiguous, default to **Deep Analysis**.

---

## Creative

Divergent ideation — quantity and variety over polish.

1. **Restate the challenge** in one sentence
2. **Obvious solutions** — 2-3 conventional approaches (acknowledge, then move past)
3. **Wild ideas** — 5-7 unconventional approaches. Mix:
   - Inversion (what if we did the opposite?)
   - Analogy (how does a different domain solve this?)
   - Removal (what if we deleted the constraint?)
   - Combination (what if we merged two approaches?)
4. **Diamond pick** — which 1-2 wild ideas have real potential and why
5. **Next step** — one concrete action to explore the best idea

---

## Deep Analysis

Multi-angle exploration for complex topics.

1. **Frame the question** precisely — what is actually being asked?
2. **Technical** — mechanics, constraints, and trade-offs
3. **Practical** — what does this look like in practice? What's the effort and friction?
4. **Strategic** — how does this fit the bigger picture? What does it enable or block?
5. **Tensions** — where do the angles disagree? What can't be optimized simultaneously?
6. **Synthesis** — what the analysis reveals that wasn't obvious at the surface

---

## Examples

**Example 1 → First Principles**
```
User: "why is our test suite so slow?"
→ Intent: root cause, decompose
→ Invoke first-principles: "Why is the test suite slow?"
→ Break down: what makes tests slow? → I/O, parallelism, fixtures, network calls
→ Challenge each assumption: are all these tests necessary? Is the slowness uniform?
```

**Example 2 → Council**
```
User: "should we use a monorepo or separate repos?"
→ Intent: debate, weigh options
→ Invoke council with the question
→ Multiple perspectives argue in parallel, then synthesize
```

**Example 3 → Creative**
```
User: "how could we make onboarding more engaging?"
→ Intent: brainstorm, possibilities
→ Restate: "How do we make first-run onboarding feel less like a form?"
→ Obvious: wizard steps, progress bar, skip option
→ Wild: game mechanic for first task, video from the AI, co-pilot mode for first session
→ Diamond pick: co-pilot mode — high novelty, directly addresses the friction
```

**Example 4 → Deep Analysis**
```
User: "what are the tradeoffs of server-side rendering?"
→ Intent: explore tradeoffs, implications
→ Technical: hydration cost, TTFB vs TTI, caching strategies
→ Practical: team expertise, deployment complexity, SEO requirements
→ Strategic: enables progressive enhancement, constrains client-side interactivity
→ Tensions: performance vs interactivity, simplicity vs capability
→ Synthesis: SSR is a distribution of complexity, not a removal of it
```

---

## Anti-patterns

- **Don't ask which mode to use.** Detect from context and commit. The routing table is the decision — use it.
- **Don't use Deep Analysis as the default for everything.** "Should I do X or Y?" is Council. "Why is X broken?" is First Principles. Reserve Deep Analysis for genuine multi-angle exploration.
- **Don't produce shallow Creative output.** Wild ideas must genuinely challenge constraints — listing 5 obvious variations is not creative thinking.
- **Don't skip the Tensions section in Deep Analysis.** If you can't find a tension, you haven't analyzed deeply enough.
- **Don't combine modes in one response.** Pick one and commit. Mixing modes produces unfocused output.
- **Don't over-explain the routing.** One line is enough: "This is a root-cause question — First Principles." Then do the work.

---

## Rules

- **Mode detection is mandatory** — classify before starting, state it in one line
- **First Principles and Council are delegated** — always invoke those skills rather than reimplementing them
- **Creative and Deep Analysis run inline** — follow the steps above directly
- **Tensions are non-negotiable in Deep Analysis** — name at least one real conflict between the angles
- **Wild ideas in Creative must be genuinely unconventional** — if a PM would have thought of it in 30 seconds, it's not wild enough
