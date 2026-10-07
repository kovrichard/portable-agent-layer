/**
 * Rule candidates: drafts the small model wrote from repeated corrections. A
 * candidate waits here until it is proven against the turn log; only a proven
 * one becomes a draft in the rule store for the user to review.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DraftInput } from "./adaptation-rules";
import { paths } from "./paths";

export interface CandidateInput extends DraftInput {
  /** How to tell from a reply whether the steering was followed. */
  check: string;
}

export interface Candidate extends CandidateInput {
  createdAt: string;
}

function candidatesPath(): string {
  return resolve(paths.adaptation(), "candidates.jsonl");
}

export function appendCandidate(input: CandidateInput, now: Date = new Date()): void {
  const candidate: Candidate = { ...input, createdAt: now.toISOString() };
  appendFileSync(candidatesPath(), `${JSON.stringify(candidate)}\n`);
}

function parseLine(line: string): Candidate | null {
  try {
    const parsed = JSON.parse(line) as Candidate;
    return typeof parsed.createdAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function readCandidates(): Candidate[] {
  const path = candidatesPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .map(parseLine)
    .filter((candidate): candidate is Candidate => candidate !== null);
}
