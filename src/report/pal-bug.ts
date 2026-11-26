/**
 * Shadow detection of messages that say PAL itself misbehaved: code picks the
 * messages that name a PAL surface, the small tier judges them, and the verdict
 * lands in bronze as a judge_call event. Nothing acts on it yet.
 */

import type { JudgeAnswers, JudgeQuestion, JudgeRequest } from "../inference/judgment";

const PAL_SURFACE =
  /\b(pal|hooks?|status ?line|doctor|guard|skills?|reminders?|injected|your context|compaction|progress tree|opinions?|bronze)\b/i;

export function namesPalSurface(message: string): boolean {
  return PAL_SURFACE.test(message);
}

export const PAL_BUG_SYSTEM = `PAL is a layer installed on the user's machine around their AI coding agent. It runs hooks on the agent's events, injects context into the agent's prompts (git state, reminders, progress, opinions), shows a status line, ships skills, and has a command line, \`pal cli\` (doctor, update, usage and more).

Decide whether the user's message to the assistant reports that the installed PAL itself misbehaved:
- a hook failed, blocked, hung or was slow;
- context PAL injected was wrong, stale or leaked from an earlier state;
- the status line showed something false or never updated;
- a \`pal cli\` command errored or gave a wrong result;
- doctor failed, or missed a problem;
- an update, migration or install lost data or left something broken;
- a skill or a guard acted wrongly.

Answer false when:
- PAL is only the topic of the work: the user designs, builds, plans, reviews or asks about PAL's features or code;
- the user asks for a new feature or a different behavior, without saying the current one is broken;
- the user corrects the assistant's own claim, reasoning or work, even when it was about PAL;
- the user says something in PAL works;
- the problem is in another tool, or in the user's own project, its tests or its CI.

The message may be in any language and full of typos. Set surface to the part of PAL that misbehaved as a short kebab-case name, such as stop-hook or status-line; set it to an empty string when the answer is false.`;

const PAL_BUG_SCHEMA = {
  type: "object",
  properties: {
    pal_bug: { type: "boolean" },
    surface: { type: "string" },
  },
  required: ["pal_bug", "surface"],
  additionalProperties: false,
} as const;

export function palBugSchema() {
  return PAL_BUG_SCHEMA;
}

const MESSAGE_MAX = 800;

export function palBugUser(message: string): string {
  return `The user's message:\n<message>\n${message.slice(0, MESSAGE_MAX)}\n</message>`;
}

export interface PalBugVerdict {
  palBug: boolean;
  surface: string;
}

export function parsePalBug(output: string | null | undefined): PalBugVerdict | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output ?? "");
  } catch {
    return null;
  }

  const { pal_bug, surface } = (parsed ?? {}) as { pal_bug?: unknown; surface?: unknown };
  if (typeof pal_bug !== "boolean") return null;

  return {
    palBug: pal_bug,
    surface: pal_bug && typeof surface === "string" ? surface.trim() : "",
  };
}

const PAL_BUG_QUESTION: JudgeQuestion = {
  type: "noul",
  instructions:
    "Does the user's `message` to their AI assistant report that PAL, the layer installed around the assistant (its hooks, injected context, status line, skills and `pal cli` commands), misbehaved?",
  criteria: {
    true: "a hook failed, hung or was slow; injected context was wrong or stale; the status line was false; a pal cli command, doctor, an update or a migration failed or lost data; a skill or guard acted wrongly",
    false:
      "PAL is only the topic of the work, the user asks for a feature, corrects the assistant's own claim, says something works, or the problem is in another tool or the user's own project",
  },
};

function palBugAnswers(output: string): JudgeAnswers | null {
  const verdict = parsePalBug(output);

  return verdict ? { pal_bug: { noul: verdict.palBug } } : null;
}

export function palBugJudgment(message: string, sessionId?: string): JudgeRequest {
  return {
    caller: "pal-bug",
    state: { message },
    questions: { pal_bug: PAL_BUG_QUESTION },
    sessionId,
    fallback: {
      request: {
        system: PAL_BUG_SYSTEM,
        user: palBugUser(message),
        maxTokens: 100,
        timeout: 90_000,
        jsonSchema: PAL_BUG_SCHEMA,
        caller: "pal-bug",
        sessionId,
      },
      parse: palBugAnswers,
    },
  };
}
