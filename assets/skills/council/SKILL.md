---
name: council
description: "Multi-perspective parallel debate on a decision — 3-5 independent perspectives argue in parallel, then synthesize into a verdict. Use when debating, weighing options, or needing multiple viewpoints on a question."
argument-hint: <question or decision>
metadata:
  source: portable-agent-layer
  derived-from: https://github.com/danielmiessler/LifeOS
  triggers:
    - "council"
    - "debate"
    - "weigh the options"
    - "multiple perspectives"
    - "argue both sides"
    - "pros and cons"
    - "second opinion"
---

Debate $ARGUMENTS from multiple perspectives:

## Step 1: Define Perspectives

Choose 3-5 perspectives relevant to the topic. Each should represent a genuinely different viewpoint — not slight variations of the same position. Examples:
- Technical feasibility vs business value vs user experience
- Short-term pragmatism vs long-term architecture vs risk aversion
- Builder vs user vs critic

## Step 2: Round 1 — Opening Positions (Parallel)

Spawn one subagent per perspective **in parallel (in a single message)**.

Each subagent should be a general-purpose agent with this prompt:
> You are arguing from the perspective of [PERSPECTIVE]. The question is: [QUESTION]. State your position and primary argument in 100-200 words. Be specific and opinionated — do not hedge.

## Step 3: Round 2 — Challenges (Parallel)

After collecting Round 1 results, spawn another batch of subagents **in parallel (in a single message)**. Each perspective challenges the weakest point of another's argument:

Each subagent prompt:
> You are [PERSPECTIVE A]. Here are the opening positions: [all Round 1 results]. Challenge the weakest point of [PERSPECTIVE B]'s argument in 100 words. Be direct.

## Step 4: Synthesis (You, Not Agents)

As the orchestrating agent, synthesize the debate:

- **Points of agreement** across perspectives
- **Remaining disagreements** and why they persist
- **Verdict:** recommended action with confidence level (high/medium/low)
- **Key risk** if the recommendation is wrong
- **Decision reversal trigger** — what new information would change the recommendation

## Important

- All subagent spawns per round MUST be in a **single message** for parallel execution
- Perspectives should be genuinely diverse, not strawmen
- The synthesis is YOUR job — do not ask a subagent to synthesize
