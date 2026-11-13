/**
 * The rating handler's three judgments as System One questions, copied from the evaluated eval/system-one/questions.js, with each one's current small-model request as its fallback.
 */

import {
  type CorrectionKind,
  correctionKindRequest,
  parseCorrectionKind,
} from "./correction-kind";
import type {
  JudgeAnswers,
  JudgeFallback,
  JudgeQuestion,
  JudgeRequest,
  JudgeResult,
  JudgeState,
} from "./judgment";
import {
  correctionCheckRequest,
  parseCorrectionCheck,
  parseReactionLabel,
  type ReactionLabel,
  reactionRequest,
} from "./reaction-rating";

const NOT_A_CORRECTION: string[] = [
  "news about something that failed after the reply, when the reply never claimed it would work, such as a failed CI run or pasted errors",
  'asking "are you sure?" or asking the assistant to double-check, without saying the reply is wrong',
  "suggesting more, or a new requirement on top of the work",
  "asking where or how to do a step the reply described",
  "a complaint about something other than the reply",
];

const KINDS: Record<string, string | Record<string, string>> = {
  "missed-the-question": {
    means:
      "the reply did not answer what the user asked before the reply, or buried the answer",
    pick: "last: only when no more specific kind explains the mistake. A correction that is itself a question is not enough, and neither is a first reader writing 'did not answer'",
    covers:
      "the user asked why, and the reply argued for something else instead of giving the reason, even when the issue says the reply contradicted the user",
  },
  "unverified-claim":
    "the reply stated a fact or the state of something (tests pass, CI is green, a tool is missing, a fix is merged) that was wrong or never checked",
  "off-instruction": {
    means:
      "the reply went against an instruction the user had given in an earlier message: it reordered their steps, worked on a different target than the one they named, changed the scope, or put the work somewhere else, such as a separate PR",
    covers: "the user says they meant a different thing than the reply worked on",
    not: "a correction that only tells the assistant what to do instead, with no earlier instruction the reply broke",
  },
  "revisited-decision": {
    means:
      "the reply proposed or kept something the user had already ruled out or decided against earlier",
    covers:
      'the user reminds the reply of something agreed or ruled out earlier ("didn\'t we say", "we discussed")',
  },
  "stopped-short": {
    means:
      "the reply deferred, paused or handed back work the user wanted done now, or waited for something (a merge, a review, an answer) instead of starting",
    covers:
      "the reply said it would start only after something else happened, even when it also changed the order",
  },
  "wrong-format":
    "the reply ignored the shape or length the user asked for, such as a table, a list or one line, or padded the answer",
  "no-verdict": {
    means:
      "the user wanted a judgement and the reply gave none: it agreed without reasoning, listed options without picking one, or criticised without an alternative",
    covers:
      "the user asked whether something is worth it, right, or should be done, and the reply gave no clear yes or no",
  },
  "dismissed-user-view": {
    means:
      "the reply argued past or brushed aside a view or idea the user had put forward",
    not: "a why-question the reply did not answer, which is missed-the-question",
  },
  "undefined-reference": {
    means:
      "the reply used a term, name, number or id the user did not know or had not been told",
    covers:
      'the user does not know or understand something the reply referred to ("what is X?", "I don\'t get", "list them"), even when they ask about it',
  },
  "skipped-existing":
    "the reply designed or built something without checking what already exists: code, a mechanism, a tool, a convention or prior art",
  "status-quo-bias":
    "the reply treated the current setup as a fixed constraint instead of considering a better design",
  other: "none of the kinds above fits the mistake itself, or one fits only loosely",
};

const REACTION_QUESTION: JudgeQuestion = {
  type: "choice",
  instructions: {
    question:
      "How does the user's next message, `message`, react to the end of the assistant's reply, `reply_end`?",
    rule: "Judge `message` against what `reply_end` said. Answer corrected only when `message` clearly says or shows the reply was wrong; otherwise answer follow-up.",
  },
  criteria: {
    corrected: {
      means: "the message shows the reply itself was wrong",
      covers: [
        "something the reply claimed is false",
        "something the reply said was done is missing",
        "a command or step the reply gave does not work",
        "a promise the reply made was not kept",
        "the reply forgot or missed what the user asked",
        "the user still does not understand after the reply's explanation",
      ],
      not: NOT_A_CORRECTION,
    },
    repeated: "the user restates their previous request because the reply did not do it",
    praised: {
      means:
        'the user explicitly praises the reply or the work, such as "well done", "perfect", "exactly", "this works great"',
      not: 'a go-ahead, "yes", "ok" or "thanks" followed by a next instruction, which is approved',
    },
    approved: {
      means:
        "the user accepts the reply or tells the assistant to go ahead, with nothing else to fix",
      covers: 'a go-ahead, "yes", "ok" or "thanks" followed by a next instruction',
    },
    "new-topic": "the user moves to something unrelated to the reply",
    "follow-up": {
      means: "anything else on the same work",
      covers: NOT_A_CORRECTION,
    },
  },
};

const CORRECTED_QUESTION: JudgeQuestion = {
  type: "noul",
  instructions:
    "Does the user's `message` say or show that the assistant's reply, whose end is `reply_end`, was itself wrong?",
  criteria: {
    true: [
      "something the reply claimed is false",
      "something the reply said was done is not done",
      "a command or step the reply gave does not work",
      "a promise the reply made was not kept",
      "following the reply's advice or steps caused a problem",
      "the reply missed what the user asked, or is waiting on or asking for something the user had already done",
      "the user still does not understand after the reply's explanation, even when they phrase it as a question",
    ],
    false: [
      'the user wants more, or adds a requirement the reply was not asked to meet. "This needs more" or "it should also do X" is a new requirement unless the reply claimed X was already done',
      "the user cannot find where or how to do a step the reply described",
      "the user doubts the reply or asks for a check, without saying it is wrong",
      "the user reports something that failed later, when the reply never claimed it would work",
      "the user complains about something other than what the reply claimed",
      "the user decides to change or drop a feature",
    ],
  },
};

const KIND_QUESTION: JudgeQuestion = {
  type: "choice",
  instructions: {
    question:
      "The user's `message` corrected the assistant's reply, whose end is `reply_end`. Which kind of mistake made the user correct the reply?",
    judge:
      "the mistake, not the topic: a wrong claim about CI is unverified-claim, and a question about CI the reply never answered is missed-the-question",
    hint: "`first_reader_issue` is a hint, not the answer; judge the reply and the message yourself",
    overlap: "when kinds overlap, pick the most specific one",
  },
  criteria: KINDS,
};

function exchange(replyEnd: string, message: string): Record<string, string> {
  return { reply_end: replyEnd, message };
}

function judgment(
  caller: string,
  state: JudgeState,
  questions: Record<string, JudgeQuestion>,
  fallback: JudgeFallback,
  sessionId: string | undefined
): JudgeRequest {
  return { caller, state, questions, sessionId, fallback };
}

function reactionAnswers(output: string): JudgeAnswers | null {
  const label = parseReactionLabel(output);

  return label ? { reaction: { choice: label.reaction } } : null;
}

function correctedAnswers(output: string): JudgeAnswers | null {
  const label = parseCorrectionCheck(output);

  return label ? { corrected: { noul: label.reaction === "corrected" } } : null;
}

function kindAnswers(output: string): JudgeAnswers | null {
  const kind = parseCorrectionKind(output);

  return kind ? { kind: { choice: kind.kind } } : null;
}

export function reactionJudgment(
  replyEnd: string,
  message: string,
  sessionId?: string
): JudgeRequest {
  return judgment(
    "reaction",
    exchange(replyEnd, message),
    { reaction: REACTION_QUESTION },
    { request: reactionRequest(replyEnd, message, sessionId), parse: reactionAnswers },
    sessionId
  );
}

export function correctionCheckJudgment(
  replyEnd: string,
  message: string,
  sessionId?: string
): JudgeRequest {
  return judgment(
    "correction-check",
    exchange(replyEnd, message),
    { corrected: CORRECTED_QUESTION },
    {
      request: correctionCheckRequest(replyEnd, message, sessionId),
      parse: correctedAnswers,
    },
    sessionId
  );
}

export function correctionKindJudgment(
  replyEnd: string,
  message: string,
  issue: string,
  sessionId?: string
): JudgeRequest {
  return judgment(
    "correction-kind",
    { ...exchange(replyEnd, message), first_reader_issue: issue },
    { kind: KIND_QUESTION },
    {
      request: correctionKindRequest(replyEnd, message, issue, sessionId),
      parse: kindAnswers,
    },
    sessionId
  );
}

export function reactionLabelOf(result: JudgeResult): ReactionLabel | null {
  return parseReactionLabel(result.fallbackOutput);
}

export function correctionCheckOf(result: JudgeResult): ReactionLabel | null {
  return parseCorrectionCheck(result.fallbackOutput);
}

export function correctionKindOf(result: JudgeResult): CorrectionKind | null {
  return parseCorrectionKind(result.fallbackOutput);
}
