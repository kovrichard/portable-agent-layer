/**
 * Rule candidates: drafts the small model wrote from repeated corrections, each
 * with the proof of its trigger. A proven candidate becomes a draft rule; one
 * whose trigger failed becomes a draft that can only be kept as an opinion, since
 * the mistake recurs even when no pattern catches it, but only once its kind has
 * recurred enough to measure. One the log is still too short to judge waits and
 * is proven again as the log grows. A new proof is appended as the candidate's
 * whole state, and reading keeps each candidate's newest proof.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../bronze/bronze";
import {
  addDraft,
  type DraftInput,
  type OpinionGate,
  readRules,
  type TriggerProof,
} from "./adaptation-rules";
import type { RequestedTurn } from "./adaptation-turns";
import { opinionGate } from "./opinion-gate";
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
  /** When it was proven again; absent on the line that recorded it. */
  provedAt?: string;
} & ({ verdict: ProofVerdict; proof: TriggerProof } | { verdict: "untriggered" });

function candidatesPath(): string {
  return resolve(storeDir("rule-candidates"), "candidates.jsonl");
}

function parseLine(line: string): Candidate | null {
  try {
    const parsed = JSON.parse(line) as Candidate;

    return typeof parsed.createdAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function newerProof(kept: Candidate, other: Candidate): Candidate {
  const keptAt = kept.provedAt ?? "";
  const otherAt = other.provedAt ?? "";
  if (keptAt !== otherAt) return otherAt > keptAt ? other : kept;

  return JSON.stringify(other) > JSON.stringify(kept) ? other : kept;
}

/** Each candidate once, as last proven, in the order they were recorded. */
export function readCandidates(): Candidate[] {
  const path = candidatesPath();
  if (!existsSync(path)) return [];
  const byId = new Map<string, Candidate>();

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const candidate = parseLine(line);
    if (!candidate) continue;
    const seen = byId.get(candidate.id);
    byId.set(candidate.id, seen ? newerProof(seen, candidate) : candidate);
  }

  return [...byId.values()].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
}

function appendCandidate(candidate: Candidate): void {
  appendFileSync(candidatesPath(), `${JSON.stringify(candidate)}\n`);
}

function provedAfter(candidate: Candidate, now: Date): string {
  const previous = candidate.provedAt ? Date.parse(candidate.provedAt) + 1 : 0;

  return new Date(Math.max(now.getTime(), previous)).toISOString();
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
  appendCandidate(candidate);
  promoteIfDecided(candidate, turns);

  return candidate;
}

const proofOf = (candidate: Candidate) =>
  JSON.stringify(
    "proof" in candidate ? [candidate.verdict, candidate.proof] : candidate.verdict
  );

/** Proves each waiting candidate again and appends the proofs that changed. */
export function reproveWaiting(turns: RequestedTurn[], now: Date = new Date()): void {
  for (const waiting of readCandidates().filter((c) => c.verdict === "waiting")) {
    const reproved = prove(waiting, turns);
    if (proofOf(reproved) === proofOf(waiting)) continue;
    const candidate = { ...reproved, provedAt: provedAfter(waiting, now) };
    appendCandidate(candidate);
    promoteIfDecided(candidate, turns);
  }
}
