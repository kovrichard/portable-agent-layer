---
name: rule-review
license: MIT
description: "Review the adaptation rule drafts PAL wrote from the user's corrections and record the user's approve-or-deny decision for each via the rule CLI. Use when the user asks what rule drafts are waiting, wants to review pending rules, or says to approve or deny a rule draft. Not for editing the shipped steering hints or for the opinion tracker."
argument-hint: "[list | approve <id> | deny <id>]"
metadata:
  source: portable-agent-layer
  triggers:
    - "rule-review"
    - "rule review"
    - "rule drafts"
    - "pending rules"
    - "review rules"
    - "approve the rule"
    - "deny the rule"
    - "adaptation rules"
---

# Rule review

An adaptation rule is "when this situation happens (trigger), steer the assistant like this (steering)", backed by evidence from the user's past corrections. PAL drafts them; every rule starts as a draft and steers nothing until the user approves it. A denied draft stays on record so it is never drafted again. A draft can only be approved or denied, never edited.

Your job: show the user the drafts and record their decision. The decision is the user's alone. Never approve or deny a draft the user has not explicitly decided on.

## Workflow

### 1. List the drafts

When the user asks what rule drafts are waiting, wants to review rules, or invokes the skill without an id, run:

```bash
pal cli rule list
```

Each draft prints as:

```
<id>  [draft]  <situation>
  trigger (<prompt|reply>): <pattern>
  steering: <steering>
  evidence: <line>
```

- If the output is `No drafts waiting.`, tell the user that and stop.
- Otherwise present every draft in the format under "Output format", then ask the user to approve or deny each one. Keep the ids from this listing; they are what a follow-up decision refers to.

When the user asks about rules already decided (approved, denied, history, all rules), run `pal cli rule list --all` instead and present them the same way, showing each rule's status.

### 2. Resolve which draft the user means

Map the user's decision to exactly one draft id before running anything:

- The user names an id → use that id.
- The user says "approve it", "deny it", "approve", "deny", "yes approve", or "reject" right after you presented exactly one draft → use that draft's id.
- The user says "approve them all" or "deny all" after a listing → one command per listed id, in the order listed.
- The user refers to a draft by its content ("the one about commit messages") and exactly one presented draft matches → use its id.
- Anything else, including several drafts presented with no id named, or a decision given before any listing in this conversation → do not guess. Run step 1 if there is no listing yet, then ask which id the user means.

A bare "yes", "ok", "fine", or "looks good" is not a decision. Ask "approve or deny <id>?" and wait.

### 3. Record the decision

Run the matching command:

```bash
pal cli rule approve <id>
pal cli rule deny <id>
```

Report the CLI's result line verbatim, e.g. `Rule 3f9a1c2e approved: <situation>`.

If the command exits 1, report its reason verbatim. The reasons are `No rule with id <id>` and `Rule <id> was already <approved|denied>`. On the first, re-run `pal cli rule list` and show the current ids. On the second, say the draft was already decided and leave it.

### 4. Handle requests to change a draft

Editing a draft is not supported, so never offer it and never rewrite a draft's text yourself. When the user wants a different wording, scope, or steering, say so and give the two options: deny the draft, or approve it as is. Then wait for that decision.

## Output format

Present each draft as one compact block, nothing else in between:

```
Draft <id>
  When:     <situation>
  Steer:    <steering>
  Evidence: <evidence line>
            <evidence line>
```

Follow the list with one question, e.g. "Approve or deny each? Reply with the id and your decision." After a single draft, "Approve or deny <id>?" is enough.

After each decision, output the CLI's result line (or error reason) verbatim and nothing more unless the user asked a question.

## When to use

- The user asks what rule drafts are pending, waiting, or need review.
- The user asks to review, approve, or deny an adaptation rule.
- The user says "approve it" or "deny it" right after you presented a draft.
- The user asks which rules have been approved or denied so far.

## Do NOT use

- To change the shipped contextual-steering hints. Those live under the `steering` key in `pal-settings.json`, not in rules.
- For the opinion tracker (confirming or contradicting a tracked preference). That is the `opinion` skill.
- To edit, reword, or merge a draft. Editing is not supported; the only outcomes are approve or deny.
- To approve or deny on the user's behalf because a draft "looks reasonable". Wait for the explicit decision.
