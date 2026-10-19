---
name: reinforce
license: MIT
description: "Keep a behavior the user praised, so it steers every later session. PROACTIVE: when the user praises how you worked (pushed back with a reason, checked before claiming, kept it short) or says 'keep this up', 'more of this', 'love that you…', ask once whether to keep it as a reinforcement and record their answer via the rule CLI. Not for praise of an output alone (a good quiz, a nice design), and not for corrections — those are drafted as rules on their own."
argument-hint: "[list | approve <id> | deny <id> | add]"
metadata:
  source: portable-agent-layer
  triggers:
    - "reinforce"
    - "reinforcement"
    - "keep this up"
    - "keep doing this"
    - "more of this"
    - "love your"
    - "love that you"
---

# Reinforce

A reinforcement is "in this situation, keep doing this", learned from praise. It is an adaptation rule with polarity `reinforce`: approved, it is injected into every session under **Keep doing**, with its own cap (5 entries, 700 characters) apart from the opinions.

PAL drafts one in the background from every praise that names a behavior. Your job is to ask while the praise is fresh, and to record the user's answer. The decision is the user's alone: never approve or deny a reinforcement the user has not explicitly decided on.

## Workflow

### 1. Ask once, right after the praise

Name the behavior as a situation and an instruction, general enough to apply beyond this topic, and ask in one line:

> Keep this as a reinforcement? *When the user counter-proposes after I disagreed → argue again if a concrete flaw remains.*

Skip the question when the praise is about the output alone and names no behavior.

### 2. On yes, approve the draft or write one

The background draft usually exists by the time the user answers:

```bash
pal cli rule list
```

Find the `[draft reinforcement]` whose evidence quotes this praise, then:

```bash
pal cli rule approve <id>
```

If none matches (the draft is missing or names a different behavior), write it directly and deny the mismatched draft if there is one:

```bash
pal cli rule add-reinforcement --when "<situation>" --steering "<behavior to keep, imperative>" --evidence "<the praise, quoted>"
```

### 3. On no, deny the draft

```bash
pal cli rule deny <id>
```

A denied draft stays on record and is not drafted again.

### 4. Report

One line: what was kept or denied, and its id. A refusal (cap reached) names the reason: offer to retire an older reinforcement with `pal cli rule retire <id>`, and only retire one the user picks.
