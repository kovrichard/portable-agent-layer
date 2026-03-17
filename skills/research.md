---
name: research
description: Deep multi-source research on a topic with synthesis
---

When the user invokes /research <topic>:

1. Decompose the topic into 3-5 specific questions
2. For each question, search multiple sources (web, docs, code)
3. Cross-reference findings — flag contradictions
4. Synthesize into:
   - **TLDR** (1 sentence)
   - **Key findings** (bullet points, each with source)
   - **Conflicting info** (if any)
   - **Confidence** per finding (high/medium/low)
   - **Follow-up questions** worth exploring
5. Total output under 1000 words unless the user asks for more
