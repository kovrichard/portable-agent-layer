# The coach gives a verdict on every transcript and correction

## Goal

On the same finished task (#138), three coach runs gave 5, 1 and 0 findings. The last one took 22 s and 9 turns, read 2 of the run's 8 transcripts, and said nothing about the user's correction (aaaa93c) it was given. Nothing in the coach's output shows what it skipped, so a skim looks the same as a clean run.

After this change the coach's result **must** account for every input it was given: one verdict per role transcript and one per user correction, each either "finding" (naming the finding's class) or "clean" (with a reason). The orchestrator checks that coverage in code. A run that leaves inputs out gets one chance to finish them, and then it's recorded as incomplete. A skipped input is visible and never counts as reviewed.

## Acceptance criteria

1. `COACH_RESULT` in `roles.mjs` gets a required `reviewed` array. Each item has:
   - `source`: a transcript path, or a correction commit sha, exactly as listed in the coach's instructions;
   - `verdict`: `finding` or `clean`;
   - `class`: the finding's class, when the verdict is `finding`;
   - `reason`: one sentence. For `clean` it says what was checked and why nothing needs to change.

   A test pins the schema.
2. After the coach returns, `coach.mjs` compares `reviewed` with the transcripts and corrections it gave the coach. Inputs are missing when either:
   - a given input has no item;
   - a `finding` verdict names a class that is neither among the run's findings nor a pending finding's class.

   A test covers a complete result, a missing transcript, a missing correction and a verdict with an unknown class.
3. When inputs are missing, `coach.mjs` resumes the same coach session once (`--resume <sessionId>`) and lists exactly what's missing. The second result's `reviewed` items and findings are merged with the first's. A test with a fake `claude` covers a run that completes on resume.
4. If inputs are still missing after the resume, the run records a `coach_incomplete` event listing them. The findings it did return are still stored. A correction without a verdict is **not** marked as given, so the next coach run gets it again. A test covers both.
5. `coach_finished` carries `reviewed` (verdicts received) and `expected` (inputs given). A test covers the counts.
6. `agents/coach.md` tells the coach that it must return a verdict for every listed transcript and correction, and that "clean" needs a reason naming what it checked. A test pins this.
7. The plugin README's coach section describes `reviewed`, the coverage check, the resume and `coach_incomplete`.
8. All gates in `.dark-factory.json` pass. Commits are conventional: `test(dark-factory): …` and `feat(dark-factory): …`. One pull request into `canary`.

## Out of scope

- Judging whether a "clean" reason is true. The verdicts make skipping visible, and the trial judges quality.
- Changing what the coach is given, or the generality check.
- Any role prompt other than `coach.md`.

## Decisions

- The spec is approved: build it. The user typed "go" (2026-10-20, 14:56).

- Specced on the user's "trial run" (2026-10-20, 14:25) and "it is live" (14:55, canary.13 installed).
- This is trial run 1 of 5 for the coach. Before reading the coach's output for each run, the PO writes down what it noticed by hand. The coach is dropped if it adds nothing beyond that over 5 runs, or if fewer than half its findings are worth approving.
- The fix is structural (a schema plus a check in code), not prompt wording, because three runs on the same input showed the prompt alone doesn't make the coach thorough.
- Category `feature`: new behaviour inside the existing coach.
