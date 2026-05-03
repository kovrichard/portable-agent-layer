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
- **Topic shape inside a block — preferred, not required: what → proof → mechanics → advanced → exercise.** A useful default ordering for depth topics. Skip any beat that doesn't fit the topic. Reorder if a different sequence teaches better. Variability is expected; this is the shape to fall back to when nothing better suggests itself.
  - **What** — what it is + landscape framing (who built it, who supports it, who doesn't), if it matters.
  - **Proof** — only if you have a *genuinely* interesting stat, eval, or incident. See the big-stat rule below.
  - **Mechanics** — how it actually works: scopes, locations, semantics, limits.
  - **Advanced** — patterns, extensions, teaser hooks for later blocks/days.
  - **Exercise** — bullets are *principles* (learner takeaway), notes carry facilitation.
- **Big-stat is for genuinely interesting numbers, not a checkbox.** Use the `big-stat` layout when you have a stat that *changes the room's mind* — a real eval result, a striking incident metric, a non-obvious cost number. Don't manufacture one. A topic without a strong stat skips the proof slide; a generic stat dilutes every later one. Format when used: h1 = the number with `<em class="unit">`, h2 = the comparison-with-context (named alternatives, named source).
- **~50% slides / ~50% hands-on.** If deck-time exceeds half the block's runtime, cut slides — not exercise time.
- **Recall check at every block boundary.** A question slide between blocks: "Before we move on — what would you do if X?" One question, no answer, deliberate silence. Forces consolidation.
- **Question slides as discussion prompts.** Bold question, no answer, no bullets. Use sparingly (2–3 per day max) — overuse breaks the room's trust that you have answers.
- **Energy curve matters.**
  - Hardest cognitive lift in the morning, before lunch.
  - Live coding right after lunch is malpractice (post-meal energy crash).
  - Demos and discussion in the afternoon.
  - End each day on synthesis or a payoff demo, never on dense content.
- **Buffer / reserve slides per block.** Every block has 1–2 slides marked optional (in the deck, not separate) used only if pace allows. Lets you stretch comfortably without scrambling. Marker convention: filename suffix `-reserve` (e.g., `045-reserve-extra-eval-example.md`) and a `<!-- reserve -->` comment at the top of the slide so the doctor can flag if any are still flagged at build time.
- **Exercise slides follow a strict template.**
  - **Title prefix `Exercise — `** so the room sees the mode change.
  - **Bullets = principles, not procedure.** What the learner *takes away* by doing the exercise. Procedure ("5 minutes solo, then we compare two") goes in notes.
  - **Standard note beats, in order:** `Facilitation`, `Common output`, `Common mistakes`, `Anticipated questions`. Use these names verbatim — the speaker scans by them.
  - **Keep principles transferable.** A bullet that only makes sense in the context of this specific repo isn't a principle; demote it to a note example.

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

**Bad exercise slide — procedure on the slide, no transferable principle:**

```markdown
<!-- .slide: data-layout="content" -->
## Write a CLAUDE.md

- Open your favorite repo
- Spend 5 minutes writing CLAUDE.md
- We'll pick 2 to share
- Discuss what worked
```

**Good exercise slide — principles on the slide, procedure in notes:**

```markdown
<!-- .slide: data-layout="content" -->
## Exercise — write your CLAUDE.md

- Capture conventions, not procedures (procedures belong in skills)
- One fact per line, no prose paragraphs
- Glossary entries earn their place — only project-specific terms
- Order matters — most-violated rules first, model reads top-down
- Commit it; use `.local.md` only for personal overrides

Note:
- Facilitation
  - 5 min solo on a repo they know
  - 2 volunteers show on screen
  - group critiques against the failure modes from prior slides
- Common output
  - "Use Polly for retries, not custom code"
  - "Tests live in `tests/Unit/`, not `src/__tests__/`"
- Common mistakes
  - writing instructions that should be skills
  - copying a generic style guide instead of capturing real violations
- Anticipated questions
  - "Should this be in AGENTS.md or CLAUDE.md?" — symlink and stop choosing
  - "What if there's already one?" — diff against it; usually adds 30%
```
