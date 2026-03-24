---
name: research
description: Multi-agent parallel research — quick/standard/extensive modes with specialized researcher agents for depth, breadth, and verification. Use when researching a topic, finding information, or investigating something thoroughly.
argument-hint: <topic or question>
---

## Mode Routing

| User says | Mode | Agents |
|-----------|------|--------|
| "quick research" / "minor research" | Quick | 1 agent |
| "research" / "do research" (default) | Standard | 2 parallel agents |
| "extensive research" / "deep research" | Extensive | 6 parallel agents |

## Available Researcher Agents

- **claude-researcher** — academic depth, query decomposition, scholarly synthesis
- **multi-perspective-researcher** — breadth, multiple angles, diverse viewpoints
- **investigative-researcher** — verification rigor, triple-checks, source credibility

## Quick Mode

Spawn **1 subagent** for a focused answer:

- Spawn `claude-researcher` with the full query and context

Wait for the result, then deliver it directly with light formatting.

## Standard Mode (Default)

Craft **2 different queries** optimized for each researcher's strengths, then spawn both **in parallel (in a single message)**:

- Spawn `claude-researcher` with a query optimized for depth/analysis
- Spawn `multi-perspective-researcher` with a query optimized for breadth/perspectives

**Query design:**
- claude-researcher: focus on authoritative sources, technical depth, how/why
- multi-perspective-researcher: focus on different stakeholder views, trade-offs, alternatives

## Extensive Mode

Craft **6 queries** (2 per researcher type, each from a different angle), then spawn all **in parallel (in a single message)**:

- Spawn `claude-researcher` — angle 1: core technical depth
- Spawn `claude-researcher` — angle 2: historical context / evolution
- Spawn `multi-perspective-researcher` — angle 3: stakeholder perspectives
- Spawn `multi-perspective-researcher` — angle 4: cross-domain connections
- Spawn `investigative-researcher` — angle 5: verify key claims
- Spawn `investigative-researcher` — angle 6: find contradictions / counter-evidence

## Synthesis (All Modes)

After collecting agent results, synthesize into:

1. **TLDR** — 1-2 sentence answer
2. **Key findings** — bullet points, grouped by theme, noting which agent(s) found each
3. **Cross-source agreement** — findings confirmed by multiple agents (high confidence)
4. **Conflicts** — where agents disagree, with both sides presented
5. **Gaps** — what remains unknown or needs further investigation
6. **Sources** — deduplicated list of verified URLs from all agents

Keep total output under 1500 words unless the user asks for more.

## Important

- All subagent spawns for a given mode MUST be in a **single message** for true parallel execution
- Do NOT run agents sequentially — that defeats the purpose
- Each agent returns independently — expect different formats and overlapping findings
- The synthesis step is YOUR job as the orchestrating agent, not the subagents'
