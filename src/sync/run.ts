/**
 * One sync run on a set-up machine, under a lock so a hook and a hand-run sync
 * never sync the same home at once. A lock older than ten minutes belongs to a
 * run that died and is taken over.
 */

import { rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAccount, storeFor } from "./account";
import type { SyncResult } from "./context";
import { syncStateDir } from "./state";
import { markFinished, markRunning } from "./status";
import { type PhaseRunner, syncOnce } from "./sync";

const LOCK_STALE_MS = 10 * 60_000;

export type SyncRun =
  | { outcome: "synced"; result: SyncResult }
  | { outcome: "not-set-up" }
  | { outcome: "busy" };

const lockFile = (home: string) => resolve(syncStateDir(home), "sync.lock");

function lockIsStale(home: string, now: number): boolean {
  const lock = statSync(lockFile(home), { throwIfNoEntry: false });

  return lock !== undefined && now - lock.mtimeMs >= LOCK_STALE_MS;
}

function takeLock(home: string, now: number): boolean {
  if (lockIsStale(home, now)) rmSync(lockFile(home), { force: true });

  try {
    writeFileSync(lockFile(home), String(process.pid), { flag: "wx" });

    return true;
  } catch {
    return false;
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runSync(
  home: string,
  phase?: PhaseRunner,
  now: number = Date.now()
): Promise<SyncRun> {
  const account = readAccount(home);
  if (!account) return { outcome: "not-set-up" };

  if (!takeLock(home, now)) return { outcome: "busy" };
  markRunning(home, now);

  try {
    const result = await syncOnce({
      store: storeFor(account.store),
      account: account.key,
      home,
      phase,
    });
    markFinished(home, Date.now(), { result });

    return { outcome: "synced", result };
  } catch (err) {
    markFinished(home, Date.now(), { error: messageOf(err) });
    throw err;
  } finally {
    rmSync(lockFile(home), { force: true });
  }
}
