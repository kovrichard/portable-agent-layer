/**
 * Rule candidates: drafts the small model wrote from repeated corrections, each
 * with the proof of its trigger. Only a proven candidate becomes a draft in the
 * rule store for the user to review; one the log is still too short to judge
 * waits and is proven again as the log grows.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDraft, type DraftInput, type TriggerProof } from "./adaptation-rules";
import type { RequestedTurn } from "./adaptation-turns";
import { paths } from "./paths";
import {
  type ProofVerdict,
  proofVerdict,
  proveTrigger,
  widenedProofVerdict,
} from "./rule-proof";

export interface CandidateInput extends DraftInput {
  check: string;
}

export interface Candidate extends CandidateInput {
  id: string;
  createdAt: string;
  verdict: ProofVerdict;
  proof: TriggerProof;
}

function candidatesPath(): string {
  return resolve(paths.adaptation(), "candidates.jsonl");
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

function writeCandidates(candidates: Candidate[]): void {
  const path = candidatesPath();
  const pending = `${path}.${process.pid}.tmp`;
  writeFileSync(pending, candidates.map((c) => `${JSON.stringify(c)}\n`).join(""));
  renameSync(pending, path);
}

function prove(candidate: Candidate, turns: RequestedTurn[]): Candidate {
  const proof = proveTrigger(candidate.trigger, turns);
  const verdict = candidate.widens ? widenedProofVerdict(proof) : proofVerdict(proof);
  return { ...candidate, proof, verdict };
}

function promoteIfPassed(candidate: Candidate): void {
  if (candidate.verdict !== "passed") return;
  const { id: _id, createdAt: _createdAt, verdict: _verdict, ...draft } = candidate;
  addDraft(draft);
}

export function recordCandidate(
  input: CandidateInput,
  turns: RequestedTurn[],
  now: Date = new Date()
): Candidate {
  const fresh = {
    ...input,
    id: randomUUID().slice(0, 8),
    createdAt: now.toISOString(),
  } as Candidate;
  const candidate = prove(fresh, turns);
  writeCandidates([...readCandidates(), candidate]);
  promoteIfPassed(candidate);
  return candidate;
}

export function reproveWaiting(turns: RequestedTurn[]): void {
  const candidates = readCandidates();
  if (!candidates.some((c) => c.verdict === "waiting")) return;
  const updated = candidates.map((c) => (c.verdict === "waiting" ? prove(c, turns) : c));
  writeCandidates(updated);
  updated.filter((c, i) => candidates[i].verdict === "waiting").forEach(promoteIfPassed);
}
