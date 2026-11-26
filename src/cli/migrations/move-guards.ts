import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statfsSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../../bronze/bronze";
import { palHome, paths } from "../../core/paths";
import { filesUnder } from "./file-hash";
import { recordMemoryMove } from "./verified-move";

export interface GuardSeams {
  now: () => number;
  isAlive: (pid: number) => boolean;
  freeBytes: (dir: string) => number;
}

const BUSY_WINDOW_MS = 20_000;
const TAIL_BYTES = 256 * 1024;
const OWN_EVENT_TYPES = new Set(["memory_move", "migration_run"]);

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

function freeBytesOn(dir: string): number {
  const stats = statfsSync(dir);

  return stats.bavail * stats.bsize;
}

const realSeams: GuardSeams = {
  now: Date.now,
  isAlive: processIsAlive,
  freeBytes: freeBytesOn,
};

function tailOf(file: string): string {
  const size = statSync(file).size;
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");

  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }

  return buffer.toString("utf-8");
}

function eventTimesIn(text: string): number[] {
  return text.split("\n").flatMap((line) => {
    try {
      const event = JSON.parse(line) as { type?: string; ts?: string };

      return OWN_EVENT_TYPES.has(event.type ?? "") ? [] : [Date.parse(event.ts ?? "")];
    } catch {
      return [];
    }
  });
}

function newestOutsideEvent(since: number): number | null {
  const dir = storeDir("events");
  const times = readdirSync(dir)
    .map((name) => resolve(dir, name))
    .filter((file) => file.endsWith(".jsonl") && statSync(file).mtimeMs >= since)
    .flatMap((file) => eventTimesIn(tailOf(file)))
    .filter((ts) => ts >= since);

  return times.length > 0 ? Math.max(...times) : null;
}

function recentEventReason(seams: GuardSeams): string[] {
  const now = seams.now();
  const newest = newestOutsideEvent(now - BUSY_WINDOW_MS);
  if (newest === null) return [];

  return [`a bronze event was written ${Math.round((now - newest) / 1000)}s ago`];
}

function pidIn(file: string): number | null {
  if (!existsSync(file)) return null;

  try {
    const text = readFileSync(file, "utf-8");
    const pid = text.trim().startsWith("{")
      ? (JSON.parse(text) as { pid?: unknown }).pid
      : Number(text);

    return Number.isInteger(pid) && (pid as number) > 0 && pid !== process.pid
      ? (pid as number)
      : null;
  } catch {
    return null;
  }
}

function liveProcessReason(file: string, what: string, seams: GuardSeams): string[] {
  const pid = pidIn(file);

  return pid !== null && seams.isAlive(pid) ? [`${what} is running (pid ${pid})`] : [];
}

/** What keeps PAL in use right now; empty when a move may run. */
export function busyReasons(seams: Partial<GuardSeams> = {}): string[] {
  const all = { ...realSeams, ...seams };

  return [
    ...recentEventReason(all),
    ...liveProcessReason(paths.serverState(), "the control room", all),
    ...liveProcessReason(
      resolve(paths.memory(), "state", "collect.lock"),
      "a bronze collect",
      all
    ),
  ];
}

export function sizeOf(dir: string): number {
  if (!existsSync(dir)) return 0;

  return filesUnder(dir).reduce((sum, file) => sum + statSync(file).size, 0);
}

/** Why the filesystem holding the PAL home is too full for a backup plus its verify copy, or null. */
export function diskShortfall(seams: Partial<GuardSeams> = {}): string | null {
  const all = { ...realSeams, ...seams };
  const needed = 2 * paths.dataRoots().reduce((sum, root) => sum + sizeOf(root), 0);
  const free = all.freeBytes(palHome());

  return free < needed
    ? `${free} bytes free, the move needs ${needed} (twice the data folders)`
    : null;
}

/** Refuses a move while PAL is busy (unless forced) or the disk is short, and records the refusal. */
export function moveGuardRefusal(
  name: string,
  options: { force?: boolean; seams?: Partial<GuardSeams> } = {}
): string | null {
  const busy = options.force ? [] : busyReasons(options.seams);
  if (busy.length > 0) {
    recordMemoryMove(name, { outcome: "refused", reason: "busy" }, { busy });

    return `PAL is in use: ${busy.join("; ")}`;
  }

  const shortfall = diskShortfall(options.seams);
  if (!shortfall) return null;

  recordMemoryMove(name, { outcome: "refused", reason: "low disk" }, { shortfall });

  return `not enough disk: ${shortfall}`;
}
