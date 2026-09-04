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
import { calcPatch } from "fast-myers-diff";
import { currentAttribution, type RecordAttribution } from "./actor";
import { encodeAnchor } from "./anchor";
import { ensureDir, paths } from "./paths";
import { isSensitivePath } from "./sensitive-path";

/**
 * What became of the action.
 *
 * `failed` and `denied` are kept apart because they answer different questions.
 * A failure is the agent's own attempt not working — a bad path, a stale match,
 * a permission on disk. A denial is a human refusing it. Collapsing them would
 * lose the only signal in the record that says where the boundary was drawn,
 * and "what did I try that was refused" is a question worth being able to ask
 * separately from "what did I try that broke".
 */
export type LedgerOutcome = "applied" | "failed" | "denied";

/**
 * One side of a change, identified rather than reproduced. The hash ties the
 * entry to a real file — apply the delta to something matching `before.hash`
 * and you must land on `after.hash` — and the byte count says how big that file
 * was without keeping it.
 */
export interface LedgerState {
  hash: string;
  bytes: number;
}

/**
 * One contiguous replacement. `at` and `remove` index the before-state and are
 * not shifted by earlier hunks in the same delta, which is what the diff
 * produces and what applying them in order with a running offset expects.
 */
export interface LedgerHunk {
  at: number;
  remove: number;
  insert: string[];
}

/**
 * What changed, at line granularity.
 *
 * Storing this rather than both whole files is what lets the record scale with
 * the size of the change instead of the size of the file. Under the old shape a
 * four-line edit to a large file kept two hashes and nothing else, so the
 * entries that said least were the ones about the biggest files.
 */
export interface LedgerDelta {
  hunks: LedgerHunk[];
  /** Set when the change itself was too large to keep. Its absence means the hunks are complete. */
  truncated?: boolean;
  /** Set when the target is one whose contents the ledger never keeps. */
  redacted?: boolean;
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
  /** Null when nothing landed, which is what a failed or denied action means. */
  after: LedgerState | null;
  /**
   * The change from one side to the other. Absent when nothing landed: an
   * action that was refused did not empty the file, and a delta saying it did
   * would be the ledger stating something that never happened.
   */
  delta?: LedgerDelta;
  /** Why the action did not land. Absent on an applied one. */
  reason?: string;
}

export interface RecordActionInput {
  tool: string;
  /** Absolute path of the file the action targeted. */
  target: string;
  outcome: LedgerOutcome;
  /** Prior content; null for a file creation, and withheld for a sensitive target. */
  before: string | null;
  /** Identity of the prior content, when the content itself was withheld. */
  beforeState?: LedgerState;
  /** Resulting content; null when nothing landed. */
  after: string | null;
  reason?: string;
}

/**
 * A change larger than this is recorded as having happened without being kept.
 * It caps the delta rather than the files, so what fits is decided by how much
 * an action changed, not by how big the thing it changed happened to be.
 */
const MAX_DELTA_BYTES = 4096;

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
  return { hash: hash(content), bytes: Buffer.byteLength(content, "utf-8") };
}

/**
 * Splitting on newlines keeps the trailing one: "a\n" becomes ["a", ""], and
 * joining puts it back. A file and its line list round-trip exactly, which is
 * what makes a reconstructed after-state hash-identical to the real one.
 */
function toLines(content: string | null): string[] {
  return content === null ? [] : content.split("\n");
}

/**
 * The change between two states, or nothing when there was no transition to
 * describe. An action that did not land has no delta — see LedgerEntry.delta.
 */
const WITHHELD: LedgerDelta = { hunks: [], redacted: true };

function deltaFor(input: RecordActionInput): LedgerDelta | undefined {
  if (isSensitivePath(input.target)) return WITHHELD;
  return deltaOf(input.before, input.after);
}

function deltaOf(before: string | null, after: string | null): LedgerDelta | undefined {
  if (after === null) return undefined;

  const hunks: LedgerHunk[] = [];
  for (const [at, end, insert] of calcPatch(toLines(before), toLines(after))) {
    hunks.push({ at, remove: end - at, insert: [...insert] });
  }
  if (hunks.length === 0) return undefined;

  const delta: LedgerDelta = { hunks };
  return Buffer.byteLength(JSON.stringify(delta), "utf-8") > MAX_DELTA_BYTES
    ? { hunks: [], truncated: true }
    : delta;
}

/**
 * Rebuild the after-state from the before-state and the delta, or nothing when
 * the delta was too large to keep.
 *
 * This is what makes an entry checkable rather than merely plausible: the hash
 * of what this returns must equal the entry's `after.hash`. It is also the read
 * side of the ledger — a stored change is only evidence if it can be replayed.
 */
export function applyDelta(before: string | null, delta: LedgerDelta): string | null {
  if (delta.truncated || delta.redacted) return null;

  const lines = toLines(before);
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of delta.hunks) {
    out.push(...lines.slice(cursor, hunk.at), ...hunk.insert);
    cursor = hunk.at + hunk.remove;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
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
 * An action that did not land is recorded like any other: a log that keeps only
 * what succeeded cannot answer what was attempted, which is usually the question
 * being asked of it.
 */
export function recordAction(input: RecordActionInput): LedgerEntry {
  const delta = deltaFor(input);
  const entry: LedgerEntry = {
    id: generateId(),
    ts: new Date().toISOString(),
    ...currentAttribution(),
    tool: input.tool,
    target: encodeAnchor(input.target),
    outcome: input.outcome,
    before: input.beforeState ?? stateOf(input.before),
    after: stateOf(input.after),
    ...(delta ? { delta } : {}),
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
  beforeState?: LedgerState;
  ts: string;
}

/** How long a snapshot waits for a second half that may never come. */
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

function withheldWhenSensitive(snapshot: PendingSnapshot): PendingSnapshot {
  if (snapshot.before === null || !isSensitivePath(snapshot.target)) return snapshot;
  const state = stateOf(snapshot.before);
  return { ...snapshot, before: null, ...(state ? { beforeState: state } : {}) };
}

export function savePending(snapshot: PendingSnapshot): void {
  const withheld = withheldWhenSensitive(snapshot);
  writeFileSync(pendingPath(withheld.toolUseId), JSON.stringify(withheld), "utf-8");
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
 * Drop snapshots nothing ever claimed.
 *
 * Applying, failing and being denied by auto mode all fire a second half that
 * claims the snapshot. What is left here is the endings that fire nothing after
 * the pre-tool half — a manual denial at the permission dialog, a deny rule, a
 * pre-tool hook's own block — plus anything interrupted mid-call.
 *
 * They are dropped rather than recorded because the ledger would have to invent
 * which of those it was. The attempt is real and currently goes unrecorded; see
 * the manual-denial gap in the project's ISCs.
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
