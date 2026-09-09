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

import { writeFile } from "node:fs/promises";
import { matrix } from "../../tools/control-room/matrix";
import { handoffFile, readHandoffs, withWaitingOn } from "../../tools/lib/handoff-note";
import { type AgendaMove, readAgenda, writeAgenda } from "../lib/agenda-store";
import { linkInputs, readGoalLinks, writeGoalLinks } from "../lib/goal-links";
import { canInfer, inference } from "../lib/inference";
import { logDebug, logError } from "../lib/log";
import { SONNET_MODEL } from "../lib/models";
import { readAllProjects } from "../lib/projects";
import { isServesKind, SERVES_KINDS, setServes } from "../lib/serves";
import { readTelosGoals } from "../lib/telos-goals";
import { logTokenUsage } from "../lib/token-usage";

const FRESH_HOURS = 6;
const MAX_PROJECTS_PER_GUESS = 40;
const MAX_WAITING_PER_RUN = 3;

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

const LINKS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    links: {
      type: "array" as const,
      description: "One entry per goal you were given, no others",
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          goalId: { type: "string" as const },
          projects: {
            type: "array" as const,
            description:
              "Slugs of the projects that move this goal forward, copied exactly. Empty when none does.",
            items: { type: "string" as const },
          },
        },
        required: ["goalId", "projects"] as const,
      },
    },
  },
  required: ["links"] as const,
};

const WAITING_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    question: {
      type: "string" as const,
      description:
        "The one thing the work needs from the person before it can move, in their own terms. Empty string when the handoff asks nothing of them.",
    },
  },
  required: ["question"] as const,
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
          project: {
            type: "string" as const,
            description:
              "The slug of the project this move belongs to, exactly as given, or an empty string when it belongs to none",
          },
        },
        required: ["move", "because", "project"] as const,
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
    model: SONNET_MODEL,
    caller: "agenda-serves",
    sessionId,
  });
  if (result.usage) logTokenUsage("agenda-serves", result.usage, SONNET_MODEL);
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
  const lines = rankedItems(grid).map((item) => {
    const why = item.urgentBecause.join(", ") || "nothing pressing";
    const waiting = item.waitingOn ? ` — waiting on the user for: ${item.waitingOn}` : "";
    return `- [${item.kind}] ${item.label}: ${item.importantBecause}; ${why}${waiting}`;
  });
  return lines.length > 0 ? lines.join("\n") : "Nothing is ranked yet.";
}

/**
 * Only when the goals or the project set moved. A stop that changed neither
 * costs nothing, which is what makes this affordable on every session.
 */
async function refreshGoalLinks(
  sessionId?: string
): Promise<"fresh" | "written" | "failed"> {
  const goals = readTelosGoals();
  const projects = readAllProjects().filter((p) => p.status === "active");
  if (goals.length === 0 || projects.length === 0) return "fresh";

  const inputs = linkInputs(
    goals.map((g) => g.id),
    projects.map((p) => p.name)
  );
  if (readGoalLinks()?.inputs === inputs) return "fresh";

  const described = projects
    .map(
      (p) =>
        `- ${p.name}: ${(p.goal ?? p.problem ?? "").replace(/\s+/g, " ").slice(0, 200) || "no description on record"}`
    )
    .join("\n");
  const listed = goals.map((g) => `- ${g.id}: ${g.text}`).join("\n");

  const result = await inference({
    system: [
      "You are told a person's stated goals and their active projects.",
      "For each goal, name the projects that move it forward.",
      "Judge from the goal and the project description only. A project that merely resembles a goal in subject does not serve it — it has to move it.",
      "A goal that nothing serves gets an empty list, and that is a useful answer rather than a failure.",
      "Copy project slugs exactly. Return one entry per goal you were given.",
    ].join("\n"),
    user: `Their goals:\n${listed}\n\nTheir active projects:\n${described}`,
    maxTokens: 600,
    timeout: 90000,
    jsonSchema: LINKS_SCHEMA,
    model: SONNET_MODEL,
    caller: "agenda-goal-links",
    sessionId,
  });
  if (result.usage) logTokenUsage("agenda-goal-links", result.usage, SONNET_MODEL);
  if (!result.success || !result.output) return "failed";

  const parsed = parsePayload<{ links: { goalId: string; projects: unknown }[] }>(
    result.output,
    "agenda:goal-links"
  );
  if (!parsed?.links) return "failed";

  const goalIds = new Set(goals.map((g) => g.id));
  const slugs = new Set(projects.map((p) => p.name));
  const links = parsed.links
    .filter((l) => goalIds.has(l.goalId))
    .map((l) => ({
      goalId: l.goalId,
      projects: (Array.isArray(l.projects) ? l.projects : []).filter(
        (slug): slug is string => typeof slug === "string" && slugs.has(slug)
      ),
    }));

  await writeGoalLinks({ generatedAt: new Date().toISOString(), inputs, links });
  return "written";
}

/**
 * An auto handoff is a transcript excerpt nobody framed, so it never carries the
 * question the work is stuck on — which is exactly the field three surfaces read.
 * Most handoffs are stuck on nothing, so an empty answer is the common one.
 */
async function extractWaitingOn(sessionId?: string): Promise<number> {
  const pending = Object.entries(readHandoffs()).filter(
    ([, h]) =>
      h.source === "auto" && h.status === "in-progress" && h.handoff && !h.waitingOn
  );
  if (pending.length === 0) return 0;

  let written = 0;
  for (const [cwd, entry] of pending.slice(0, MAX_WAITING_PER_RUN)) {
    const result = await inference({
      system: [
        "You are given the last exchange of a coding session that stopped mid-work.",
        "Decide whether the work is blocked on the person — a decision only they can make, a question they were asked and did not answer, an approval the work needs.",
        "Most sessions are not blocked on anyone. Waiting for an agent to continue is not being blocked on the person.",
        "When it is blocked, answer with the question in their own terms, under fifteen words.",
        "When it is not, answer with an empty string. That is the ordinary answer.",
      ].join("\n"),
      user: entry.handoff,
      maxTokens: 120,
      timeout: 60000,
      jsonSchema: WAITING_SCHEMA,
      model: SONNET_MODEL,
      caller: "agenda-waiting-on",
      sessionId,
    });
    if (result.usage) logTokenUsage("agenda-waiting-on", result.usage, SONNET_MODEL);
    if (!result.success || !result.output) continue;

    const parsed = parsePayload<{ question: string }>(result.output, "agenda:waiting-on");
    const question = parsed?.question?.trim();
    if (!question) continue;
    const store = withWaitingOn(readHandoffs(), cwd, question);
    await writeFile(handoffFile(), JSON.stringify(store, null, 2), "utf-8");
    written++;
  }
  return written;
}

function rankedItems(grid: ReturnType<typeof matrix>) {
  return [...grid.now, ...grid.plan, ...grid.noise];
}

/** A model asked for a project name will invent one; only a slug it was shown counts. */
function knownSlug(candidate: unknown, slugs: Set<string>): string | null {
  return typeof candidate === "string" && slugs.has(candidate) ? candidate : null;
}

async function writeMoves(sessionId?: string): Promise<boolean> {
  const slugs = new Set(
    rankedItems(matrix())
      .filter((i) => i.kind === "project")
      .map((i) => i.id)
  );
  const result = await inference({
    system: [
      "You write the first three lines a person reads in the morning.",
      "You are given their goals and a ranked list of their projects and goals with the reason each was ranked.",
      "Write exactly three moves, most consequential first.",
      "A move is a sentence naming an action, not a project name: 'Send ACE the mapping one-pager' beats 'work on ontology'.",
      "Prefer what is blocked on the person themselves, then what serves a goal, then what is merely urgent.",
      "Name the project each move belongs to, copying its slug exactly from the list you were given. A move that belongs to no project takes an empty string.",
      "Never invent a fact that is not in what you were given.",
    ].join("\n"),
    user: `Their goals:\n${goalsBrief()}\n\nWhat is ranked and why:\n${matrixBrief()}`,
    maxTokens: 400,
    timeout: 90000,
    jsonSchema: MOVES_SCHEMA,
    model: SONNET_MODEL,
    caller: "agenda-moves",
    sessionId,
  });
  if (result.usage) logTokenUsage("agenda-moves", result.usage, SONNET_MODEL);
  if (!result.success || !result.output) return false;

  const parsed = parsePayload<{ moves: (AgendaMove & { project?: unknown })[] }>(
    result.output,
    "agenda:moves"
  );
  const moves: AgendaMove[] = (parsed?.moves ?? [])
    .filter((m) => m.move)
    .slice(0, 3)
    .map(({ move, because, project }) => {
      const slug = knownSlug(project, slugs);
      return slug ? { move, because, project: slug } : { move, because };
    });
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
  const linked = await refreshGoalLinks(sessionId);
  const waiting = await extractWaitingOn(sessionId);
  const wrote = await writeMoves(sessionId);
  logDebug(
    "agenda",
    `serves guessed: ${guessed}, links: ${linked}, waitingOn: ${waiting}, moves written: ${wrote}`
  );
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
