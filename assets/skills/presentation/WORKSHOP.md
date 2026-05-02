# Workshop-specific content rules

Read [`SKILL.md`](SKILL.md) first — the general content principles apply unchanged. This file only adds the rules that are specific to workshops, training sessions, and hands-on formats.

A workshop is not a talk. The deck is scaffolding for the room's work, not the work itself. If the slides could be read alone and convey the value, it isn't a workshop — it's a recorded lecture.

## Rules

- **Block arc: opener → core → demo/exercise → synthesis.** Every block follows this shape.
  - **Opener** — one slide that earns the block: a stat, a story, a failure case. "Why should you care for the next 45 minutes?"
  - **Core** — the actual material. The teaching slides.
  - **Demo or exercise** — the participants do something or watch something done. Live, not recorded.
  - **Synthesis** — one slide that closes the loop: "what you now know" or "what you can do tomorrow."
  - Skip a beat and the block falls flat. Especially the opener.
- **~50% slides / ~50% hands-on.** If deck-time exceeds half the block's runtime, cut slides — not exercise time.
- **Recall check at every block boundary.** A question slide between blocks: "Before we move on — what would you do if X?" One question, no answer, deliberate silence. Forces consolidation.
- **Question slides as discussion prompts.** Bold question, no answer, no bullets. Use sparingly (2–3 per day max) — overuse breaks the room's trust that you have answers.
- **Energy curve matters.**
  - Hardest cognitive lift in the morning, before lunch.
  - Live coding right after lunch is malpractice (post-meal energy crash).
  - Demos and discussion in the afternoon.
  - End each day on synthesis or a payoff demo, never on dense content.
- **Buffer / reserve slides per block.** Every block has 1–2 slides marked optional (in the deck, not separate) used only if pace allows. Lets you stretch comfortably without scrambling. Marker convention: filename suffix `-reserve` (e.g., `045-reserve-extra-eval-example.md`) and a `<!-- reserve -->` comment at the top of the slide so the doctor can flag if any are still flagged at build time.

## Examples

**Bad opener — describes the agenda instead of earning the block:**

```markdown
<!-- .slide: data-layout="content" -->
## Security block

- Prompt injection
- Tool aliasing
- Credential exposure
- Hook-based guardrails
```

**Good opener — a real incident earns the next 90 minutes:**

```markdown
<!-- .slide: data-layout="big-stat" -->
# 9 seconds
## Replit production database, deleted by an agent

Note:
- [Replit prod-DB deletion — postmortem](https://...)
- Agent had unscoped DB credentials in its environment
- "Drop the dev tables" → matched against prod by mistake
- This is the failure mode the next 90 minutes prevent
- "Could Claude Code do this?" — yes, if you give it `.env` with prod creds
```

**Bad recall slide — gives the answer:**

```markdown
<!-- .slide: data-layout="content" -->
## Recap

- Tier 1 = enterprise sanctioned
- Tier 2 = paid + settings off
- Tier 3 = prohibited
```

**Good recall slide — forces the room to retrieve:**

```markdown
<!-- .slide: data-layout="quote" -->
> Your colleague asks if she can paste a 20-line C# snippet
> from our payment service into ChatGPT Plus. What do you say?

Note:
- Let the room answer first, ~30 seconds of silence is fine
- Correct: depends on classification — if Confidential, no; if Internal, sanitize and yes (settings off)
- Don't give the answer until at least one person tries
```
