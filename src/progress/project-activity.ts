/**
 * When a project was last worked in. This machine's touches stay in its own
 * state folder, because rewriting the synced ISA.md after every turn would make
 * two machines' copies conflict all day; the newest history line arrives from
 * every machine that syncs.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { storeDir } from "../bronze/bronze";
import { stateDir } from "../core/paths";

const HISTORY_TAIL_BYTES = 4096;

const touchFile = () => resolve(stateDir(), "project-touch.json");

function readTouches(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(touchFile(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function recordProjectTouch(name: string, at: Date = new Date()): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(
    touchFile(),
    JSON.stringify({ ...readTouches(), [name]: at.toISOString() })
  );
}

function historyTail(name: string): string {
  const file = resolve(storeDir("project-history"), name, "history.jsonl");

  try {
    const size = statSync(file).size;
    const tail = Buffer.alloc(Math.min(size, HISTORY_TAIL_BYTES));
    const fd = openSync(file, "r");

    try {
      readSync(fd, tail, 0, tail.length, size - tail.length);
    } finally {
      closeSync(fd);
    }

    return tail.toString("utf-8");
  } catch {
    return "";
  }
}

function lastHistoryDay(name: string): string | undefined {
  const day = /"date":"(\d{4}-\d{2}-\d{2})"[^\n]*\n?$/.exec(historyTail(name))?.[1];

  return day ? `${day}T00:00:00.000Z` : undefined;
}

/** The latest of the record's own time, this machine's last touch and the last history day. */
export function lastActivity(name: string, recorded: string | undefined): string {
  const times = [recorded, readTouches()[name], lastHistoryDay(name)];

  return (
    times
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1) ?? ""
  );
}
