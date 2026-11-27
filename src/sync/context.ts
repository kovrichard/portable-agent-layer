import type { BlobStore } from "./blob-store";
import { SyncCryptoError } from "./crypto";
import type { FileKeys } from "./keys";
import type { SyncState } from "./state";

export type SyncFailure =
  | "tampered"
  | "bad-signature"
  | "rollback"
  | "missing"
  | "shrunk"
  | "out-of-scope";

export class SyncRefusal extends Error {
  constructor(readonly failure: SyncFailure) {
    super(`sync refused: ${failure}`);
  }
}

export interface SyncResult {
  pushed: number;
  /** Lines appended here from other machines, not counting their own sync events. */
  pulled: number;
  written: string[];
  quarantined: string[];
  refused: string[];
}

export interface SyncContext {
  home: string;
  store: BlobStore;
  account: Uint8Array<ArrayBuffer>;
  machine: string;
  keys: FileKeys;
  state: SyncState;
  result: SyncResult;
}

export function emptyResult(): SyncResult {
  return { pushed: 0, pulled: 0, written: [], quarantined: [], refused: [] };
}

/** Runs one file's or machine's work; a refusal is recorded and the rest goes on. */
export async function orRefuse(
  ctx: SyncContext,
  target: string,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work();
  } catch (err) {
    if (err instanceof SyncRefusal || err instanceof SyncCryptoError)
      ctx.result.refused.push(`${target}: ${err.failure}`);
    else throw err;
  }
}
