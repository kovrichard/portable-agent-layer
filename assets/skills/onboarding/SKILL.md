---
name: onboarding
license: MIT
description: "Interview the user to fill in the personal context PAL has none of: their TELOS topics, one per pass, and their timezone. Use when the user wants to set up or flesh out that context: onboard me, fill in my telos, interview me about my goals, PAL doesn't know anything about me, help me write my mission, what should PAL know about me."
argument-hint: "[topic to start with]"
metadata:
  source: portable-agent-layer
  triggers:
    - "onboarding"
    - "onboard me"
    - "fill in my telos"
    - "set up my telos"
    - "interview me about my goals"
    - "personal context is empty"
    - "you don't know anything about me"
    - "help me write my mission"
---

Fill the personal context by asking, one topic per pass, and write only what the user actually said.

TELOS is the context that orients every future session: purpose, goals, obstacles, methods, principles. The timezone is what makes "this morning" mean anything. A fresh install ships the TELOS files as empty scaffolds and guesses the timezone from the machine, and both stay that way until someone asks. This skill is that asking. It is deliberately not part of install: a user who has just installed a tool cannot yet say what they want from it, and answers given under that pressure are worse than no answers.

## Ask the CLI what is missing

```bash
pal cli telos
```

It prints every topic as answered or unanswered, in interview order, and names the next unanswered one. That command owns the definition of "unanswered" — a scaffold of headings and empty bullets is not an answer. Do not open the files to judge for yourself, and do not restate the rule here: one definition, in one place, is the point.

Read a file only when you need the format of an existing entry, or when the user asks what is already on record.

## Workflow

1. Run `pal cli telos`.

2. Pick this pass's topic:
   - The user named one in the argument → use it, answered or not.
   - Otherwise → the `next:` topic the command printed.
   - `next: none` → say so, list what is on file in one line each, and offer the optional topics. Do not re-interview an answered topic unless asked.

   | File | The question behind it |
   |------|------------------------|
   | `MISSION.md` | What are you actually doing with your working life? |
   | `GOALS.md` | What are you working toward, by when? |
   | `CHALLENGES.md` | What is in the way right now? |
   | `STRATEGIES.md` | How do you approach work and decisions? |
   | `BELIEFS.md` | What principles do you refuse to trade away? |
   | `MODELS.md` `NARRATIVES.md` `LEARNED.md` `IDEAS.md` | Optional, on request only |

3. Open the topic with one sentence saying why the answer changes how you behave in future sessions, then ask **one** question. Never ask two questions in one turn, and never present a numbered list of questions to work through.

4. Follow up until the answer is specific enough to act on. A usable answer names something concrete: a company, a role, a date, an amount, a named obstacle. A vague answer ("grow professionally", "be healthier") gets one follow-up asking for the concrete version. Stop after two follow-ups on the same point whether or not it got sharper.

5. Draft the entry in the file's existing format, show it, and ask for a yes before writing. The draft may only contain what the user said in this conversation. If they went quiet on part of it, that part is absent from the draft, not filled in by you.

6. Write it with the telos tool, never by editing the file:

   ```bash
   bun ~/.pal/skills/telos/tools/update-telos.ts <FILE> "<content>" "<description>"
   ```

   `<FILE>` is the bare filename, `<description>` is a short line naming what the entry covers and the date it was given.

7. Report what landed, name the next unanswered topic, and stop. One topic per invocation. The user resumes by invoking the skill again, whenever that is.

## The timezone

Check it on the first pass only:

```bash
pal cli timezone                    # show what is configured
pal cli timezone Europe/Budapest    # set it, IANA names only
```

Install prefills it from the machine, so it is usually already right and usually not worth a question. Ask only when it reads as not set, or when the user has corrected you about the date or the hour in this session. Settings are hook-protected, so this command is the only way to change it — never edit `pal-settings.json`.

## Never invent an answer

The whole value of this context is that it is the user's own words. An invented goal is worse than an empty file, because every later session treats it as fact and ranks work against it.

- Do not draft an answer from the repository, the user's projects, their git history, or anything you inferred earlier in the session.
- Do not offer a filled-in answer for confirmation. "Is your mission to build a small consultancy?" invites a yes that was yours, not theirs.
- You may offer two or three short examples of the *kind* of answer the question wants, clearly marked as examples from nobody in particular, when the user is stuck.
- "I don't know" is a valid answer. Say the topic stays open, write nothing, and move to the next one.
- If the user's answer contradicts what is already on file, show both and ask which holds. Do not merge them silently.

## Output format

Conversational, not a form. Per pass:

- One line on why this topic matters to future sessions.
- One question, then a real exchange.
- A drafted entry shown before writing, and an explicit request to confirm.
- After writing: one line confirming the file, and one line naming the next unanswered topic.

## When to use

- The user asks to be onboarded or interviewed, or to fill in, set up, or flesh out their personal context.
- The user says PAL knows nothing about them, or asks what it should know.
- A task needs personal context (ranking work, weighing a decision) and `pal cli telos` reports the relevant topic unanswered. Offer this skill; do not start the interview uninvited.

## Do NOT use

- To read, view, or summarize existing TELOS content, or to record a single stated change to it — that is the `telos` skill.
- To act on a timezone the user simply states ("we moved to Berlin") — run `pal cli timezone` and move on. No interview.
- To record an observation about the user made during other work — that is a relationship note.
- To set the assistant's name or the startup catchphrase — that is identity, and `pal cli init` asks for it.
- To fill several topics in one pass because the user seems willing. One topic per invocation is the design; long forms produce shallow answers.
