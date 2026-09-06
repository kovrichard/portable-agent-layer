/**
 * Stop handler: what to do tomorrow morning.
 *
 * Two jobs, both too slow and too expensive for a page load, so both happen
 * here and land in files the morning screen only reads.
 *
 * 1. Guess what each project serves, once, so importance can be ranked at all.
 *    A guess never overwrites the user's own answer.
 * 2. Write three moves for the day — sentences, not project names, because the
 *    answer to "what now" is rarely "open a repository".
 */

import { matrix } from "../../tools/control-room/matrix";
import { type AgendaMove, readAgenda, writeAgenda } from "../lib/agenda-store";
import { canInfer, inference } from "../lib/inference";
import { logDebug, logError } from "../lib/log";
import { readAllProjects } from "../lib/projects";
import { isServesKind, SERVES_KINDS, setServes } from "../lib/serves";
import { readTelosGoals } from "../lib/telos-goals";
import { logTokenUsage } from "../lib/token-usage";

const FRESH_HOURS = 6;
const MAX_PROJECTS_PER_GUESS = 40;

function hoursSince(iso: string, now: Date): number {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - at) / 3_600_000;
}

const SERVES_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    projects: {
      type: "array" as const,
      description: "One entry per project you were given, no others",
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          name: { type: "string" as const },
          serves: { type: "string" as const, enum: SERVES_KINDS },
          note: {
            type: "string" as const,
            description: "Six words at most on what it serves",
          },
        },
        required: ["name", "serves", "note"] as const,
      },
    },
  },
  required: ["projects"] as const,
};

const MOVES_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    moves: {
      type: "array" as const,
      description: "Exactly three, most consequential first",
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          move: {
            type: "string" as const,
            description: "One sentence, an action the user can start today",
          },
          because: {
            type: "string" as const,
            description: "One short clause naming the evidence it came from",
          },
        },
        required: ["move", "because"] as const,
      },
    },
  },
  required: ["moves"] as const,
};

function goalsBrief(): string {
  const goals = readTelosGoals();
  if (goals.length === 0) return "The user has not written any goals down yet.";
  return goals
    .map((g) => {
      const by = g.due ? ` [by ${g.due}]` : "";
      return `- ${g.text}${by}`;
    })
    .join("\n");
}

/** A model's JSON is untrusted input like any other payload. */
function parsePayload<T>(raw: string, caller: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    logError(caller, err);
    return null;
  }
}

/** Only projects with no purpose on record — a guess is made once, not nightly. */
async function guessMissingServes(sessionId?: string): Promise<number> {
  const missing = readAllProjects()
    .filter((p) => !p.serves && (p.status === "active" || p.status === "paused"))
    .slice(0, MAX_PROJECTS_PER_GUESS);
  if (missing.length === 0) return 0;

  const described = missing
    .map((p) => {
      const purpose = (p.goal ?? p.problem ?? "").replace(/\s+/g, " ").slice(0, 200);
      return `- ${p.name}: ${purpose || "no description on record"}`;
    })
    .join("\n");

  const result = await inference({
    system: [
      "You are told a person's goals and a list of their projects.",
      "For each project, decide which of three things it serves:",
      '"goal" — it moves one of the stated goals forward;',
      '"revenue" — it is a way the work could pay, even speculatively;',
      '"fun" — it is kept for its own sake.',
      "Judge from the goals and the project description only. Never assume a project is unimportant because it is small or quiet.",
      "Return one entry per project you were given.",
    ].join("\n"),
    user: `Their goals:\n${goalsBrief()}\n\nTheir projects:\n${described}`,
    maxTokens: 700,
    timeout: 90000,
    jsonSchema: SERVES_SCHEMA,
    caller: "agenda-serves",
    sessionId,
  });
  if (result.usage) logTokenUsage("agenda-serves", result.usage);
  if (!result.success || !result.output) return 0;

  const parsed = parsePayload<{
    projects: { name: string; serves: string; note: string }[];
  }>(result.output, "agenda:serves");
  if (!parsed?.projects) return 0;

  const known = new Set(missing.map((p) => p.name));
  let written = 0;
  for (const guess of parsed.projects) {
    if (!known.has(guess.name) || !isServesKind(guess.serves)) continue;
    const outcome = setServes({
      name: guess.name,
      kind: guess.serves,
      note: guess.note,
      by: "inferred",
    });
    if (outcome === "written") written++;
  }
  return written;
}

function matrixBrief(): string {
  const grid = matrix();
  const lines = [...grid.now, ...grid.plan, ...grid.noise].map((item) => {
    const why = item.urgentBecause.join(", ") || "nothing pressing";
    const waiting = item.waitingOn ? ` — waiting on the user for: ${item.waitingOn}` : "";
    return `- [${item.kind}] ${item.label}: ${item.importantBecause}; ${why}${waiting}`;
  });
  return lines.length > 0 ? lines.join("\n") : "Nothing is ranked yet.";
}

async function writeMoves(sessionId?: string): Promise<boolean> {
  const result = await inference({
    system: [
      "You write the first three lines a person reads in the morning.",
      "You are given their goals and a ranked list of their projects and goals with the reason each was ranked.",
      "Write exactly three moves, most consequential first.",
      "A move is a sentence naming an action, not a project name: 'Send ACE the mapping one-pager' beats 'work on ontology'.",
      "Prefer what is blocked on the person themselves, then what serves a goal, then what is merely urgent.",
      "Never invent a fact that is not in what you were given.",
    ].join("\n"),
    user: `Their goals:\n${goalsBrief()}\n\nWhat is ranked and why:\n${matrixBrief()}`,
    maxTokens: 400,
    timeout: 90000,
    jsonSchema: MOVES_SCHEMA,
    caller: "agenda-moves",
    sessionId,
  });
  if (result.usage) logTokenUsage("agenda-moves", result.usage);
  if (!result.success || !result.output) return false;

  const parsed = parsePayload<{ moves: AgendaMove[] }>(result.output, "agenda:moves");
  const moves = (parsed?.moves ?? []).filter((m) => m.move).slice(0, 3);
  if (moves.length === 0) return false;

  await writeAgenda({ generatedAt: new Date().toISOString(), moves });
  return true;
}

/** Named so the caller — and a test — can tell a skip from a failure. */
export type AgendaOutcome = "fresh" | "no-inference" | "written" | "failed";

/** @lintignore exercised directly by test/agenda-handler.test.ts */
export async function refreshAgenda(
  now: Date = new Date(),
  sessionId?: string
): Promise<AgendaOutcome> {
  const existing = readAgenda();
  if (existing && hoursSince(existing.generatedAt, now) < FRESH_HOURS) return "fresh";
  if (!canInfer()) return "no-inference";

  const guessed = await guessMissingServes(sessionId);
  const wrote = await writeMoves(sessionId);
  logDebug("agenda", `serves guessed: ${guessed}, moves written: ${wrote}`);
  return wrote ? "written" : "failed";
}

if (process.argv[2] === "--run") {
  const sid = process.argv[3];
  try {
    const outcome = await refreshAgenda(new Date(), sid === "" ? undefined : sid);
    logDebug("agenda", outcome);
  } catch (err) {
    logError("agenda:run", err);
  }
  process.exit(0);
}
