/**
 * Action ledger — an append-only record of what an agent changed, and under
 * whose authority.
 *
 * A transcript says a tool was called. It does not say what the file looked
 * like before, so it cannot answer "what changed" after the fact — the prior
 * contents are gone by the time anything downstream reads it. The ledger is
 * therefore written at the moment of the change, from both sides of it.
 *
 * Scope is deliberately narrow: edits and writes, which carry their own
 * before/after in the call. A shell command's effect is not derivable from its
 * arguments, so recording one honestly would need a different mechanism than
 * this file — see the AGENTS.md rule steering file changes onto the edit tools.
 *
 * Reads and searches are excluded on purpose. They are queries, not actions,
 * and a ledger that logs them buries the changes among them.
 *
 * This module is silent. It runs inside hooks, where stdout is the agent's
 * protocol channel, so it returns what it wrote and leaves reporting to the
 * caller.
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { currentAttribution, type RecordAttribution } from "./actor";
import { encodeAnchor } from "./anchor";
import { ensureDir, paths } from "./paths";

/** Whether the action actually happened, or was stopped before it could. */
export type LedgerOutcome = "applied" | "denied";

/**
 * One side of a change. The hash is always present so an entry can be checked
 * against a file later even when the content itself was too large to keep; the
 * text is the evidence of what changed, kept only while it stays small.
 */
export interface LedgerState {
  hash: string;
  bytes: number;
  text?: string;
  /** Set when the text was dropped for size. Its absence means the text is complete. */
  truncated?: boolean;
}

export interface LedgerEntry extends RecordAttribution {
  id: string;
  ts: string;
  /** The tool that made the change — Edit or Write today. */
  tool: string;
  /** Project-anchored path, so the entry survives a different mount or machine. */
  target: string;
  outcome: LedgerOutcome;
  /** Null when nothing was there before: a file creation has no prior state. */
  before: LedgerState | null;
  /** Null when nothing landed, which is what a denied action means. */
  after: LedgerState | null;
  /** Why a denied action was stopped. Absent on an applied one. */
  reason?: string;
}

export interface RecordActionInput {
  tool: string;
  /** Absolute path of the file the action targeted. */
  target: string;
  outcome: LedgerOutcome;
  /** Prior content; null for a file creation. */
  before: string | null;
  /** Resulting content; null when nothing landed. */
  after: string | null;
  reason?: string;
}

/**
 * Content above this is recorded as hash and size only. Both sides are whole
 * files read off disk, not the changed region, so the hash is checkable against
 * the file later — and most files clear this, meaning the common entry keeps
 * its size and hash but not its text.
 */
const MAX_INLINE_BYTES = 4096;

/** Size at which the active file is rotated aside. */
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;

const ACTIVE = "actions.jsonl";

export function ledgerPath(): string {
  return resolve(paths.ledger(), ACTIVE);
}

function hash(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content, "utf-8").digest("hex");
}

function stateOf(content: string | null): LedgerState | null {
  if (content === null) return null;
  const bytes = Buffer.byteLength(content, "utf-8");
  const state: LedgerState = { hash: hash(content), bytes };
  if (bytes > MAX_INLINE_BYTES) return { ...state, truncated: true };
  return { ...state, text: content };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/**
 * Move the active file aside once it crosses the size cap, so reads stay cheap
 * without discarding anything. A count-based trim would delete the oldest
 * entries first, which in an audit record is the evidence most worth keeping.
 */
function rotateIfFull(file: string): void {
  if (!existsSync(file) || statSync(file).size < MAX_LEDGER_BYTES) return;
  renameSync(file, freeArchivePath(new Date().toISOString().replace(/[:.]/g, "-")));
}

/**
 * A name no archive already holds. Two rotations within the same millisecond
 * agree on a stamp, and renaming onto a taken name destroys that archive
 * without a trace — the one failure mode an append-only record cannot have.
 */
function freeArchivePath(stamp: string): string {
  const nth = (n: number) => {
    const suffix = n ? `-${n}` : "";
    return resolve(paths.ledger(), `actions-${stamp}${suffix}.jsonl`);
  };
  let n = 0;
  while (existsSync(nth(n))) n++;
  return nth(n);
}

/**
 * Append one action to the ledger and return the entry as written.
 *
 * A denied action is recorded like any other: an audit log that keeps only what
 * succeeded cannot answer what was attempted, which is usually the question
 * being asked of it.
 */
export function recordAction(input: RecordActionInput): LedgerEntry {
  const entry: LedgerEntry = {
    id: generateId(),
    ts: new Date().toISOString(),
    ...currentAttribution(),
    tool: input.tool,
    target: encodeAnchor(input.target),
    outcome: input.outcome,
    before: stateOf(input.before),
    after: stateOf(input.after),
    ...(input.reason ? { reason: input.reason } : {}),
  };

  const file = ledgerPath();
  rotateIfFull(file);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf-8");
  return entry;
}

/**
 * The before-state, held between the two halves of one tool call.
 *
 * A post-tool event alone cannot produce it: by the time the tool has run, the
 * prior contents are gone. So the pre-tool half reads the file and parks it
 * here, and the post-tool half claims it back and pairs it with the result.
 */
export interface PendingSnapshot {
  toolUseId: string;
  tool: string;
  target: string;
  before: string | null;
  ts: string;
}

/** Snapshots older than this were never claimed — the call was denied or it failed. */
const PENDING_TTL_MS = 60 * 60 * 1000;

function pendingDir(): string {
  return ensureDir(resolve(paths.ledger(), "pending"));
}

/**
 * A tool-call id is an identifier from another system, and it lands here as a
 * filename — so it is reduced to characters that cannot climb out of the
 * directory rather than trusted to be well-formed.
 */
function pendingPath(toolUseId: string): string {
  return resolve(pendingDir(), `${toolUseId.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
}

export function savePending(snapshot: PendingSnapshot): void {
  writeFileSync(pendingPath(snapshot.toolUseId), JSON.stringify(snapshot), "utf-8");
}

/**
 * Take the snapshot for this tool call, removing it in the same step. Claiming
 * is one-shot on purpose: a snapshot that stayed put after being read could be
 * paired with a second result and record a change that never happened.
 */
export function claimPending(toolUseId: string): PendingSnapshot | null {
  const file = pendingPath(toolUseId);
  if (!existsSync(file)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(file, "utf-8")) as PendingSnapshot;
    unlinkSync(file);
    return snapshot;
  } catch {
    unlinkSync(file);
    return null;
  }
}

/**
 * Drop snapshots nothing ever claimed. A denied or failed call fires the
 * pre-tool half and never the post-tool one, so its snapshot would otherwise
 * sit here forever — the action did not happen, and the ledger records actions.
 */
export function reapStalePending(now: number = Date.now()): number {
  const dir = pendingDir();
  let reaped = 0;
  for (const name of readdirSync(dir)) {
    const file = resolve(dir, name);
    if (now - statSync(file).mtimeMs < PENDING_TTL_MS) continue;
    unlinkSync(file);
    reaped++;
  }
  return reaped;
}
