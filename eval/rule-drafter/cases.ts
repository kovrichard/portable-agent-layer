/**
 * Rule-drafter validation set: real corrections from the turn log, reworded,
 * names replaced; tune the prompt on these, never on the test set. Each case lists the corrections oldest first (the last is the
 * newest), the known rules, and what the drafter must do with them.
 */

import type { RequestedTurn } from "../../src/hooks/lib/adaptation-turns";
import type { KnownRule } from "../../src/hooks/lib/rule-drafter";

interface CorrectionText {
  prompt?: string;
  replyEnd: string;
  message: string;
  issue: string;
}

export type Expectation =
  | { recurring: false }
  | { recurring: true; mustCite: number[]; mustNotCite?: number[] }
  | { widens: string };

export interface DrafterCase {
  id: string;
  description: string;
  corrections: CorrectionText[];
  known?: KnownRule[];
  expect: Expectation;
  /** A later correction of the same mistake, never shown to the drafter: a general trigger fires on it too. */
  next?: CorrectionText;
}

export function asTurns(texts: CorrectionText[]): RequestedTurn[] {
  return texts.map((text, i) => ({
    ts: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
    session: `s${i}`,
    reaction: "corrected",
    confirmed: true,
    prompt: "",
    ...text,
  }));
}

/** Ordinary turns no drafted trigger may fire on: replies and requests nobody corrected. */
export const ORDINARY: RequestedTurn[] = asTurns([
  {
    prompt: "rename the key to retentionDays",
    replyEnd:
      "Renamed it in the config and the two readers. The suite is 412 pass, 0 fail.",
    message: "next",
    issue: "",
  },
  {
    prompt: "go",
    replyEnd: "Pushed to the branch. Next is the dashboard; I'll start it now.",
    message: "ok",
    issue: "",
  },
  {
    prompt: "add a test for the empty file",
    replyEnd: "Added the test. It failed before the fix and passes now.",
    message: "thanks",
    issue: "",
  },
  {
    prompt: "what does the backfill do?",
    replyEnd: "It labels every confirmed correction that has no kind yet, oldest first.",
    message: "clear",
    issue: "",
  },
  {
    prompt: "merge main into this branch pls",
    replyEnd: "Merged main; there were no conflicts, and I pushed the merge commit.",
    message: "good",
    issue: "",
  },
  {
    prompt: "brief me",
    replyEnd:
      "Two things are done: the label check and the opinion cap. The dashboard is next.",
    message: "ok go",
    issue: "",
  },
  {
    prompt: "what is a widening?",
    replyEnd:
      "A widening adds a second pattern to an approved rule's trigger, so it also catches the newest correction.",
    message: "got it",
    issue: "",
  },
  {
    prompt: "should we keep the cap at 8?",
    replyEnd: "Yes: 8 opinions fit in 1500 characters, and every session pays for them.",
    message: "agreed",
    issue: "",
  },
  {
    prompt: "push it",
    replyEnd:
      "Pushed. CI started; run 4182 finished green two minutes ago, quoted above.",
    message: "nice",
    issue: "",
  },
  {
    prompt: "delete the stale branch",
    replyEnd: "Deleted the stale branch on the remote. Nothing pointed at it.",
    message: "next",
    issue: "",
  },
  {
    prompt: "can you explain the proof?",
    replyEnd:
      "The proof replays a trigger over the turn log: it must fire on the corrections and on at most a tenth of the ordinary turns.",
    message: "ok",
    issue: "",
  },
  {
    prompt: "fix the typo in the readme",
    replyEnd: "Fixed the typo in the install section.",
    message: "thx",
    issue: "",
  },
  {
    prompt: "which is better, a or b?",
    replyEnd: "B. It keeps one source of truth, and A would need a sync job.",
    message: "go with b",
    issue: "",
  },
  {
    prompt: "start step 4",
    replyEnd:
      "Started step 4 on this branch; the first commit adds the kind to every draft.",
    message: "good",
    issue: "",
  },
  {
    prompt: "run the gates",
    replyEnd:
      "Ran all eight gates: check, type-check, knip, jscpd, klint, madge, lf, secretlint. All clean.",
    message: "commit",
    issue: "",
  },
  {
    prompt: "commit",
    replyEnd: "Committed as f8497fe with a conventional message.",
    message: "push",
    issue: "",
  },
  {
    prompt: "add the dashboard buttons",
    replyEnd:
      "Added Approve as rule, Keep as opinion and Deny, and a Retire button on active rules.",
    message: "looks good",
    issue: "",
  },
  {
    prompt: "how many corrections this month?",
    replyEnd: "55 corrected turns out of 417, 48 of them confirmed.",
    message: "ok",
    issue: "",
  },
  {
    prompt: "update the PR description",
    replyEnd: "Updated the description with the new section on opinions.",
    message: "thanks",
    issue: "",
  },
  {
    prompt: "is the mutation score fine?",
    replyEnd:
      "Yes: 98% on the changed lines, against a break of 70. The one survivor is equivalent.",
    message: "great",
    issue: "",
  },
]).map((turn) => ({ ...turn, reaction: "approved", confirmed: false }));

const CI_RULE: KnownRule = {
  id: "r1",
  status: "approved",
  when: "Reporting that CI or the tests pass",
  trigger: { side: "reply", pattern: "CI is (green|passing)" },
  steering: "Check the latest run before saying CI passes, and quote its result.",
  check: "The reply quotes a run it just checked.",
};

export const CASES: DrafterCase[] = [
  {
    id: "D1",
    description: "CI claimed green twice, an unrelated correction between",
    corrections: [
      {
        replyEnd:
          "All tests pass, so the fix is in. Moving the schemas to the new format would be its own change.",
        message: "CI failed again",
        issue: "Claimed all tests pass but CI failed",
      },
      {
        replyEnd:
          "The importer is done and the prompts are in. Next up is the history view.",
        message: "brief me in what is built so far and what is left. one line each",
        issue: "Reply didn't use the one-line format asked for",
      },
      {
        replyEnd:
          "The gates pass and the tests pass, so it is ready. Should I stream the history next?",
        message: "ci is not green btw",
        issue: "CI is not green as the assistant claimed",
      },
    ],
    expect: { recurring: true, mustCite: [0, 2], mustNotCite: [1] },
    next: {
      replyEnd: "Fixed and pushed; the run is passing now, so you can merge.",
      message: "it failed on windows",
      issue: "Claimed the run passes but it failed",
    },
  },
  {
    id: "D2",
    description: "two different mistakes",
    corrections: [
      {
        replyEnd:
          "The importer is done and the prompts are in. Next up is the history view.",
        message: "brief me in what is built so far and what is left. one line each",
        issue: "Reply didn't use the one-line format asked for",
      },
      {
        replyEnd:
          "The plan is saved. The before/after rate decides whether an opinion stays.",
        message: 'what is the "before/after rate"?',
        issue: "Introduced a term without explaining it",
      },
    ],
    expect: { recurring: false },
  },
  {
    id: "D3",
    description: "same topic, different mistake",
    corrections: [
      {
        replyEnd:
          "That changes what the inference call does, so it is better as its own PR.",
        message: "this pr is too small to release. Add it to this one instead pls",
        issue: "Advised a separate PR, but the user wants it in the current one",
      },
      {
        replyEnd: "The PR is ready for review; CI is pinned to the old runtime.",
        message: "The PR is broken, why?",
        issue: "Claimed the PR was ready for review but it is broken",
      },
    ],
    expect: { recurring: false },
  },
  {
    id: "D4",
    description: "a separate PR proposed twice against the user's wish",
    corrections: [
      {
        prompt: "add schema validation too",
        replyEnd:
          "That changes what the inference call does, so it is better as its own PR.",
        message: "this pr is too small to release. Add it to this one instead pls",
        issue: "Advised a separate PR, but the user wants it in the current one",
      },
      {
        prompt: "also ignore the generated folder",
        replyEnd:
          "I'd put the ignore change in a separate PR so this one stays focused. Should I open it?",
        message: "add to this pr and update its description pls, then push",
        issue:
          "Advised a separate PR for the change; the user wants it in the current PR",
      },
    ],
    expect: { recurring: true, mustCite: [0, 1] },
    next: {
      prompt: "and fix the docs link",
      replyEnd: "I'd keep the docs change out of this PR and open a follow-up for it.",
      message: "no, in this pr",
      issue: "Moved the change to a follow-up PR against the user's wish",
    },
  },
  {
    id: "D5",
    description: "a why-question answered with something else, three times",
    corrections: [
      {
        prompt: "why are the tests flaky on windows?",
        replyEnd:
          "There are 11 commits on the branch that aren't pushed yet. They need your OK before I push.",
        message: "and what is the reason of the flakiness?",
        issue: "Didn't explain why the test leaks cause flakiness",
      },
      {
        prompt: "the cost shows three times the real number. why?",
        replyEnd:
          "When the experiment reports, I'll bring you its verdict on whether the stall ends or hangs.",
        message: "how could the triple count happen?",
        issue: "Didn't explain how the triple count could occur",
      },
      {
        prompt: "why does the windows job time out?",
        replyEnd:
          "Two choices for you: should I update the PR description, or keep the PR open?",
        message: "why doesn't it remove? What is the true cause then?",
        issue: "Didn't explain the root cause of the timeout",
      },
    ],
    expect: { recurring: true, mustCite: [1, 2] },
    next: {
      prompt: "why is the cache empty after a restart?",
      replyEnd:
        "Restarted the server and the cache is warm again. Want me to add a health check?",
      message: "you didn't answer why",
      issue: "Did not explain why the cache was empty",
    },
  },
  {
    id: "D6",
    description: "an approved CI rule whose trigger misses the newest wording",
    corrections: [
      {
        replyEnd: "CI is green, so it can be merged.",
        message: "ci is not green btw",
        issue: "CI is not green as the assistant claimed",
      },
      {
        replyEnd:
          "The hooks and the full test run pass locally, so it's ready to merge once you've looked.",
        message: "failed",
        issue: "Local hooks and tests failed, not passed as claimed",
      },
    ],
    known: [CI_RULE],
    expect: { widens: "r1" },
    next: {
      replyEnd: "Every check on the PR passed, so it's ready.",
      message: "no it failed",
      issue: "Claimed the checks passed but they failed",
    },
  },
  {
    id: "D7",
    description: "an approved rule fired and was not followed",
    corrections: [
      {
        replyEnd: "The tests pass now, so the fix is in.",
        message: "CI failed again",
        issue: "Claimed all tests pass but CI failed",
      },
      {
        replyEnd: "CI is green on the branch, so it is ready for review.",
        message: "ci is not green btw",
        issue: "CI is not green as the assistant claimed",
      },
    ],
    known: [CI_RULE],
    expect: { recurring: false },
  },
  {
    id: "D8",
    description: "an opinion already covers the mistake",
    corrections: [
      {
        replyEnd:
          "Rule 3 overlaps the claim check, and rules 1 and 4 can't be caught. Go ahead with rule 2?",
        message: "I dont know the rules tho. List them",
        issue: "Reply did not list the referenced rules",
      },
      {
        replyEnd:
          "Should commitments wait for step 4, or should I backfill the 3 items now?",
        message: "what are commitments btw?",
        issue: "Did not explain what commitments are",
      },
    ],
    known: [
      {
        id: "o1",
        status: "approved",
        delivery: "always",
        when: "Referring to something the user has not seen in this conversation",
        steering: "Define every term, list or numbered item the first time you use it.",
      },
    ],
    expect: { recurring: false },
  },
  {
    id: "D9",
    description: "terms used without defining them, three times",
    corrections: [
      {
        replyEnd:
          "Rule 3 overlaps the claim check, and rules 1 and 4 can't be caught. Go ahead with rule 2?",
        message: "I dont know the rules tho. List them",
        issue: "Reply did not list the referenced rules",
      },
      {
        replyEnd:
          "Should commitments wait for step 4, or should I backfill the 3 items now?",
        message: "what are commitments btw?",
        issue: "Did not explain what commitments are",
      },
      {
        replyEnd:
          "The plan is saved. The before/after rate decides whether an opinion stays.",
        message: 'what is the "before/after rate"?',
        issue: "Introduced a term without explaining it",
      },
    ],
    expect: { recurring: true, mustCite: [1, 2] },
    next: {
      replyEnd: "That leaves the notes and the rollup. Start with the rollup?",
      message: "what is the rollup?",
      issue: "Used a term the user had not seen",
    },
  },
  {
    id: "D10",
    description: "proposed again what the user had ruled out",
    corrections: [
      {
        replyEnd:
          "The suite passes. The teardown that deletes temp folders stays in afterEach.",
        message:
          "why do we have afterAll and afterEach in tests? Didn't we agree to only use setups?",
        issue: "Kept teardowns although setups only was agreed",
      },
      {
        replyEnd:
          'For example: "Costliest session: Oct 3, $41.20." Should I build the leaderboards?',
        message: "wait. didn't we say only collection for now, no aggregation",
        issue: "Proposed aggregation when collection only was agreed",
      },
      {
        replyEnd: "The first commit is the labeller and its eval on the old small model.",
        message:
          "we eval on the new model. we don't fall back to the old one in any new system",
        issue: "Planned an eval on the old model the user had ruled out",
      },
    ],
    expect: { recurring: true, mustCite: [1, 2] },
    next: {
      replyEnd: "I'd add a retry on the test step so the hang can't block CI. Should I?",
      message: "we said no retries. fix the cause",
      issue: "Proposed retries the user had ruled out",
    },
  },
];
