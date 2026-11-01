---
name: scheduled-prompts
license: MIT
description: "Sets up a recurring prompt that PAL delivers at a time of day from now on — a suggestion, a reminder or a standing rule that applies after 20:00, every weekday at 9, or every evening. Extracts the window, weekdays, scope and repeat from the request, rewrites the text as an instruction to the assistant, reads it back for approval, then runs pal cli schedule add. Use when the user wants something to happen or be suggested at a time of day on an ongoing basis, or wants to list or remove such schedules."
argument-hint: "<time or window> <what to prompt>"
metadata:
  source: portable-agent-layer
  triggers:
    - "scheduled-prompts"
    - "scheduled prompts"
    - "every day at"
    - "from now on at"
    - "schedule a prompt"
    - "every evening"
    - "every weekday at"
    - "every morning"
---

# Scheduled prompts

Turn $ARGUMENTS into a schedule that PAL adds to the conversation at a time of day from now on. Delivery is passive: a due schedule is attached as a system reminder to the first prompt the user writes inside its window. Nothing fires while no session is open, a missed window never fires late, and background notifications do not count as prompts. Schedules live in PAL's memory, never in the repository, and times are read in the user's configured timezone (`pal cli timezone`).

## Workflow

1. **Extract** from the request:
   - **Window** — the local time it opens (`--from HH:MM`) and, when given, the time it closes (`--to HH:MM`; default midnight; it may pass midnight, so 22:00 to 02:00 belongs to the day it opened). A word like "morning" or "evening" without a clock time becomes a proposed time (08:00, 18:00), marked as assumed in the read-back.
   - **Days** — weekdays only, as `--days mon-fri`, `sat,sun` or `mon,wed,fri`. Omit for every day.
   - **Scope** — `--project <name>` when the request is about this project's work (the default is the current registered project, or the current folder when none is registered); `--user` when it is about the user generally, in every project.
   - **Text** — the prompt rewritten as an instruction to the assistant, in the second person, under 500 characters. "After 20:00 suggest overnight tasks" becomes "Suggest one or two tasks that could run overnight with the unattended skill."
2. **Pick the repeat** from the wording. An act-once request (suggest, remind, start, prepare, review) takes the default, daily: once per day per scope, so a user schedule fires once across all sessions and a project schedule once per project. A keep-in-mind rule (always, never, while, don't, keep) takes `--every-prompt`. Use `--every-session` only when the user asks for once per session.
3. **Check for duplicates.** Run `pal cli schedule list` and compare the intent of each line with the new one; when one already says the same thing, tell the user and offer to keep it or replace it (`pal cli schedule remove <id>`, then add) rather than adding a second. Then read the opinions and rules always injected into context: when one already says the same thing at all hours, tell the user it can be retired through rule review once the schedule exists. Do not retire it yourself.
4. **Read back** the schedule in one short block (window, days, scope, repeat, text). STOP and wait for explicit approval. Do not run `add` before it. Edits return to this step.
5. **Add** after approval:
   ```bash
   pal cli schedule add "<text>" --from <HH:MM> [--to <HH:MM>] [--days <days>] [--project <name> | --user] [--every-session | --every-prompt]
   ```
   Show its output line verbatim and tell the user how to remove it: `pal cli schedule remove <id>`.

To list schedules, run `pal cli schedule list` (`--here` for the current project only); each line carries id, scope, window, days, repeat, text and whether it is open or closed now. There is no edit command: a change is a remove followed by an add, read back as in step 4.

## Output format

- Before approval: one block with five labelled lines — **Window**, **Days**, **Scope**, **Repeat**, **Text** — followed by one approval question. Nothing runs before the answer.
- After approval: the `add` command's output line as printed, the remove command, and one sentence on delivery: the prompt arrives as a system reminder on the first prompt written inside the window; nothing arrives while no session is open, and a missed window never fires late.
- For a list request: the `pal cli schedule list` output, one line per schedule, unchanged.

## When to use

- The user asks for something to happen or be suggested at a time of day from now on: "after 20:00 suggest overnight tasks", "every weekday at 9 remind me to plan the day", "after 18:00 keep replies short", "every evening ask what to park".
- The user asks what is scheduled, or wants a scheduled prompt changed or removed.

## Do NOT use

- A one-off reminder at a specific date, or work under a deadline: that is the `timebox` skill.
- Work that should continue while the user is away: that is the `unattended` skill.
- A recurring job that must run with no session open, such as a nightly build or a backup: use cron or the agent's own scheduler. A schedule only reaches a prompt the user writes.
- A scheduled prompt has just arrived as a system reminder: act on it as the user's instruction. This skill creates schedules; it does not run them.
