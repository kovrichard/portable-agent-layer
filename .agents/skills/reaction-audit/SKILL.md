---
name: reaction-audit
description: Audit PAL's code-only reaction rules (corrected, repeated, approved, new-topic, follow-up) against the maintainer's sampled real messages, and report where a model's reading disagrees, as proposed rule changes with test cases. Use when the session reminder shows "Reaction Rules Audit Due", or when asked to check or audit the reaction rules.
argument-hint: (optional) --all to audit every kept sample, not only those since the last audit
metadata:
  triggers:
    - "reaction-audit"
    - "reaction audit"
    - "reaction rules audit due"
    - "audit the reaction rules"
---

# Reaction rules audit

A **repo-only, maintainer** workflow. The rules live in `src/hooks/lib/interaction-reaction.ts`; the samples in `~/.pal/memory/state/reaction-samples.json` are messages the rules labelled, each with the end of the reply it answered. This audit **never edits the rules**. It reports, the user decides.

## Workflow

1. **Read the samples blind**, without the rule's label:
   ```bash
   bun .agents/skills/reaction-audit/tools/samples.ts          # since the last audit
   bun .agents/skills/reaction-audit/tools/samples.ts --all    # every kept sample
   ```
   If there are none, say so and stop.

2. **Label each sample yourself**, one at a time, from the message and the reply end only. Use exactly one of:
   - `corrected`: the user says the reply was wrong or missed what they asked.
   - `repeated`: the user restates their previous request.
   - `approved`: the user accepts the reply or tells you to go ahead, with nothing else to fix.
   - `new-topic`: the user moves to something unrelated to the reply.
   - `follow-up`: anything else, including questions and new instructions on the same work.

   Do not look up the rules or the stored labels before labelling. The value of this step is an independent reading. Write the labels to a temp file as `{ "<id>": "<label>" }`.

3. **Compare**:
   ```bash
   bun .agents/skills/reaction-audit/tools/compare.ts <labels.json>
   ```

4. **Judge each disagreement.** Re-read the message and reply end, then decide which side is right. A rule is wrong only when the message clearly means your label. When a message is ambiguous, the rule's label stands: the rules favour precision over recall.

5. **Group the rule misses into proposed changes.** For each: the pattern the rules miss or misfire on, the messages that show it, a concrete change to `interaction-reaction.ts`, and the test cases for `test/interaction-reaction.test.ts`, including one that must not change label. Do not quote private message text in code or tests; write a neutral case with the same shape.

6. **Present the report and stop.** Changes happen only after the user approves them, each with a failing test first.

7. **Advance the audit mark** once the user has seen the report:
   ```bash
   bun .agents/skills/reaction-audit/tools/mark-audited.ts
   ```

## Output format

- Agreement: compared, agreed, rate.
- The disagreements where the rules were right, in one line each.
- Proposed rule changes, each with its evidence and test cases.
- Confirmation the audit mark was advanced.

## Do NOT use

- Downstream: the samples and the rules only make sense to the PAL maintainer.
- To edit the rules or the samples. This skill reports only.
