---
name: think
description: Thinking mode router — selects the right analytical approach for a question. Use when thinking through a problem, analyzing deeply, brainstorming ideas, debating options, red teaming, stress testing, critiquing, poking holes, playing devil's advocate, decomposing to root cause, challenging assumptions, or exploring from multiple perspectives.
argument-hint: <question or topic>
---

Route $ARGUMENTS to the right thinking mode based on intent. Detect the mode from context — do NOT ask.

## Routing

| Intent signals | Mode | How to invoke |
|---------------|------|---------------|
| decompose, root cause, fundamental, challenge assumptions, first principles | **First Principles** | Use the Skill tool to invoke `first-principles` with $ARGUMENTS |
| debate, weigh options, multiple viewpoints, perspectives, deliberate | **Council** | Use the Skill tool to invoke `council` with $ARGUMENTS |
| critique, stress test, poke holes, devil's advocate, red team, attack this | **Red Team** | Follow the Red Team steps below with $ARGUMENTS |
| brainstorm, creative, divergent, ideas, what if, possibilities | **Creative** | Follow the Creative steps below with $ARGUMENTS |
| think through, analyze, explore deeply, examine from angles | **Deep Analysis** | Follow the Deep Analysis steps below with $ARGUMENTS |

If intent is ambiguous, default to **Deep Analysis**.

---

## Red Team

Adversarial validation of an idea, plan, or decision.

1. **Steel-man** — state the idea in its strongest form
2. **Attack surface** — 3-5 weaknesses, blind spots, or failure modes
3. **Severity rank** each (critical / significant / minor)
4. **Exploit scenario** — for the top 2, a realistic scenario where it fails
5. **Mitigations** — what would defend against each attack
6. **Verdict** — robust, fragile, or fixable? One sentence.

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

1. **Frame the question** precisely
2. **Technical** — mechanics, constraints, and trade-offs
3. **Practical** — what does this look like in practice? What's the effort?
4. **Strategic** — how does this fit the bigger picture? What does it enable or block?
5. **Tensions** — where do the angles disagree?
6. **Synthesis** — what the analysis reveals that wasn't obvious at the surface
