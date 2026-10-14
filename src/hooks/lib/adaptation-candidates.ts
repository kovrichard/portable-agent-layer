/**
 * Rule candidates: drafts the small model wrote from repeated corrections, each
 * with the proof of its trigger. A proven candidate becomes a draft rule; one
 * whose trigger failed becomes a draft that can only be kept as an opinion, since
 * the mistake recurs even when no pattern catches it, but only once its kind has
 * recurred enough to measure. One the log is still too short to judge waits and
 * is proven again as the log grows.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDraft,
  type DraftInput,
  type OpinionGate,
  readRules,
  type TriggerProof,
} from "./adaptation-rules";
import type { RequestedTurn } from "./adaptation-turns";
import { opinionGate } from "./opinion-gate";
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

export type Candidate = CandidateInput & {
  id: string;
  createdAt: string;
} & ({ verdict: ProofVerdict; proof: TriggerProof } | { verdict: "untriggered" });

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
  if (!candidate.trigger) return { ...candidate, verdict: "untriggered" };
  const proof = proveTrigger(candidate.trigger, turns);
  const verdict = candidate.widens ? widenedProofVerdict(proof) : proofVerdict(proof);
  return { ...candidate, proof, verdict };
}

function canOnlyBeOpinion(candidate: Candidate): boolean {
  const unproven = candidate.verdict === "failed" || candidate.verdict === "untriggered";
  return unproven && !candidate.widens;
}

function gateFor(candidate: Candidate, turns: RequestedTurn[]): OpinionGate | undefined {
  if (!candidate.kind || candidate.widens) return undefined;
  return opinionGate(candidate.kind, readRules(), turns);
}

function draftOf(candidate: Candidate, turns: RequestedTurn[]): DraftInput | null {
  const { id: _id, createdAt: _createdAt, verdict: _verdict, ...draft } = candidate;
  const gate = gateFor(candidate, turns);
  const gated = gate ? { ...draft, opinionGate: gate } : draft;
  if (!canOnlyBeOpinion(candidate)) return gated;
  if (!candidate.kind || (gate && "corrections" in gate)) return null;
  return { ...gated, offer: "opinion-only" };
}

function promoteIfDecided(candidate: Candidate, turns: RequestedTurn[]): void {
  if (candidate.verdict !== "passed" && !canOnlyBeOpinion(candidate)) return;
  const draft = draftOf(candidate, turns);
  if (draft) addDraft(draft);
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
  promoteIfDecided(candidate, turns);
  return candidate;
}

export function reproveWaiting(turns: RequestedTurn[]): void {
  const candidates = readCandidates();
  if (!candidates.some((c) => c.verdict === "waiting")) return;
  const updated = candidates.map((c) => (c.verdict === "waiting" ? prove(c, turns) : c));
  writeCandidates(updated);
  for (const candidate of updated.filter((_c, i) => candidates[i].verdict === "waiting"))
    promoteIfDecided(candidate, turns);
}
