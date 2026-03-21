---
name: research
description: Multi-agent parallel research — quick/standard/extensive modes with specialized researcher agents for depth, breadth, and verification
---

## Mode Routing

| User says | Mode | Agents |
|-----------|------|--------|
| "quick research" / "minor research" | Quick | 1 agent |
| "research" / "do research" (default) | Standard | 2 parallel agents |
| "extensive research" / "deep research" | Extensive | 6 parallel agents |

## Quick Mode

Launch **1 agent** for a focused answer:

```
Agent({ subagent_type: "claude-researcher", prompt: "[full query with context]" })
```

Wait for the result, then deliver it directly with light formatting.

## Standard Mode (Default)

Craft **2 different queries** optimized for each researcher's strengths, then launch both **IN A SINGLE MESSAGE** for parallel execution:

```
Agent({ subagent_type: "claude-researcher", prompt: "[query optimized for depth/analysis]" })
Agent({ subagent_type: "multi-perspective-researcher", prompt: "[query optimized for breadth/perspectives]" })
```

**Query design:**
- claude-researcher: focus on authoritative sources, technical depth, how/why
- multi-perspective-researcher: focus on different stakeholder views, trade-offs, alternatives

## Extensive Mode

Craft **6 queries** (2 per researcher type, each from a different angle), then launch all **IN A SINGLE MESSAGE**:

```
Agent({ subagent_type: "claude-researcher", prompt: "[angle 1: core technical depth]" })
Agent({ subagent_type: "claude-researcher", prompt: "[angle 2: historical context / evolution]" })
Agent({ subagent_type: "multi-perspective-researcher", prompt: "[angle 3: stakeholder perspectives]" })
Agent({ subagent_type: "multi-perspective-researcher", prompt: "[angle 4: cross-domain connections]" })
Agent({ subagent_type: "investigative-researcher", prompt: "[angle 5: verify key claims]" })
Agent({ subagent_type: "investigative-researcher", prompt: "[angle 6: find contradictions / counter-evidence]" })
```

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

- All Agent calls for a given mode MUST be in a **single message** for true parallel execution
- Do NOT run agents sequentially — that defeats the purpose
- Each agent returns independently — expect different formats and overlapping findings
- The synthesis step is YOUR job as the orchestrating agent, not the subagents'
