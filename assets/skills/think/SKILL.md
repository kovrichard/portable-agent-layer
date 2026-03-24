---
name: think
description: Thinking mode router. USE WHEN think through, analyze deeply, brainstorm, creative ideas, debate, weigh options, red team, stress test, critique, poke holes, devil's advocate, decompose, root cause, challenge assumptions, multiple perspectives, explore angles
---

Route the user's request to the right thinking mode based on intent. Do NOT ask which mode — detect it from context.

## Routing

| Intent signals | Mode | Action |
|---------------|------|--------|
| "decompose", "root cause", "fundamental", "challenge assumptions", "first principles" | **First Principles** | Invoke the `first-principles` skill |
| "debate", "weigh options", "multiple viewpoints", "perspectives", "deliberate" | **Council** | Invoke the `council` skill |
| "critique", "stress test", "poke holes", "devil's advocate", "red team", "attack this" | **Red Team** | Run Red Team mode below |
| "brainstorm", "creative", "divergent", "ideas", "what if", "possibilities" | **Creative** | Run Creative mode below |
| "think through", "analyze", "explore deeply", "examine from angles" | **Deep Analysis** | Run Deep Analysis mode below |

If intent is ambiguous, default to **Deep Analysis**.

---

## Red Team Mode

Adversarial validation of an idea, plan, or decision.

1. **Steel-man** the idea first — state it in its strongest form
2. **Attack surface** — identify 3-5 weaknesses, blind spots, or failure modes
3. **Severity rank** each weakness (critical / significant / minor)
4. **Exploit scenario** — for the top 2, describe a realistic scenario where it fails
5. **Mitigations** — what would defend against each attack
6. **Verdict** — is the idea robust, fragile, or fixable? One sentence.

---

## Creative Mode

Divergent ideation — quantity and variety over polish.

1. **Restate the challenge** in one sentence
2. **Obvious solutions** — 2-3 conventional approaches (acknowledge them, then move past)
3. **Wild ideas** — 5-7 unconventional approaches. Mix:
   - Inversion (what if we did the opposite?)
   - Analogy (how does a different domain solve this?)
   - Removal (what if we deleted the constraint?)
   - Combination (what if we merged two approaches?)
4. **Diamond pick** — which 1-2 wild ideas have real potential and why
5. **Next step** — one concrete action to explore the best idea

---

## Deep Analysis Mode

Multi-angle exploration for complex topics.

1. **Frame the question** precisely
2. **Angle 1 — Technical**: What are the mechanics, constraints, and trade-offs?
3. **Angle 2 — Practical**: What does this look like in practice? What's the effort?
4. **Angle 3 — Strategic**: How does this fit the bigger picture? What does it enable or block?
5. **Tensions** — where do the angles disagree?
6. **Synthesis** — what the analysis reveals that wasn't obvious at the surface
