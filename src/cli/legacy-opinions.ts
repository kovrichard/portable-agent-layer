import { existsSync, readFileSync, renameSync } from "node:fs";
import { basename, resolve } from "node:path";
import { paths } from "../core/paths";
import { OPINION_CAP, OPINION_CHARS } from "../hooks/lib/adaptation-rules";

export interface LegacyOpinion {
  statement: string;
  confidence: number;
  category: string;
}

export type LegacyOpinions =
  | { state: "missing" }
  | { state: "unreadable"; reason: string }
  | { state: "read"; opinions: LegacyOpinion[] };

export type ReviewOutcome = "renamed" | "missing" | "taken";

export function legacyOpinionsPath(): string {
  return resolve(paths.memory(), "relationship", "opinions.json");
}

function reviewedOpinionsPath(): string {
  return resolve(paths.memory(), "relationship", "opinions.reviewed.json");
}

function toOpinion(item: unknown): LegacyOpinion {
  const { statement, confidence, category } = (item ?? {}) as Record<string, unknown>;
  if (typeof statement !== "string" || typeof confidence !== "number")
    throw new Error("an opinion has no statement or confidence");

  return { statement, confidence, category: String(category ?? "general") };
}

function opinionsIn(raw: unknown): LegacyOpinion[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw as { opinions?: unknown } | null)?.opinions;
  if (!Array.isArray(list)) throw new Error("it holds no opinions list");

  return list.map(toOpinion).sort((a, b) => b.confidence - a.confidence);
}

export function readLegacyOpinions(): LegacyOpinions {
  const path = legacyOpinionsPath();
  if (!existsSync(path)) return { state: "missing" };

  try {
    return {
      state: "read",
      opinions: opinionsIn(JSON.parse(readFileSync(path, "utf-8"))),
    };
  } catch (error) {
    return { state: "unreadable", reason: (error as Error).message };
  }
}

export function markLegacyOpinionsReviewed(): ReviewOutcome {
  if (!existsSync(legacyOpinionsPath())) return "missing";

  if (existsSync(reviewedOpinionsPath())) return "taken";
  renameSync(legacyOpinionsPath(), reviewedOpinionsPath());

  return "renamed";
}

export function opinionCount(count: number): string {
  return count === 1 ? "1 opinion" : `${count} opinions`;
}

function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function legacyOpinionLine(opinion: LegacyOpinion): string {
  return `${percent(opinion.confidence)}  [${opinion.category}]  ${opinion.statement}`;
}

export function legacyOpinionsAdvice(): string[] {
  return [
    "Write the ones worth keeping with `pal cli rule add-opinion --kind K --when W --steering S`, then run `pal cli rule legacy-opinions --reviewed`.",
    `The new store holds at most ${OPINION_CAP} opinions, ${OPINION_CHARS} characters together, and one opinion per correction kind.`,
  ];
}

export function reviewedMessage(outcome: ReviewOutcome): string {
  if (outcome === "missing")
    return `No ${basename(legacyOpinionsPath())} to mark reviewed.`;

  if (outcome === "taken")
    return `${reviewedOpinionsPath()} already exists; move it away, then run this again.`;

  return `Renamed ${legacyOpinionsPath()} to ${basename(reviewedOpinionsPath())}.`;
}
