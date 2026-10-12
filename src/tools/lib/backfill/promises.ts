/**
 * The promises the Discord bot nags about, from its store: each one made, and
 * each one closed as done or dropped. The title is text, so it goes to the
 * content store.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent } from "../../../hooks/lib/events";
import { paths } from "../../../hooks/lib/paths";
import { emitUnseen } from "./rows";

interface StoredPromise {
  id: number;
  title: string;
  due: string;
  status: "open" | "done" | "dropped";
  createdAt: string;
  closedAt?: string;
  project?: string;
  snoozes: number;
  nagCount: number;
}

interface PromiseRow {
  id: string;
  ts: string;
  project: string | null;
  fields: Record<string, unknown>;
  title: string;
}

const secondsBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 1000);

function readPromises(): StoredPromise[] {
  const file = resolve(paths.memory(), "commitments.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")).items ?? [];
  } catch {
    return [];
  }
}

function made(promise: StoredPromise): PromiseRow {
  return {
    id: `promise:${promise.id}:${promise.createdAt}:made`,
    ts: promise.createdAt,
    project: promise.project ?? null,
    fields: { change: "made", dueInSec: secondsBetween(promise.createdAt, promise.due) },
    title: promise.title,
  };
}

function closed(promise: StoredPromise): PromiseRow[] {
  if (promise.status === "open" || !promise.closedAt) return [];
  return [
    {
      id: `promise:${promise.id}:${promise.createdAt}:${promise.status}`,
      ts: promise.closedAt,
      project: promise.project ?? null,
      fields: {
        change: promise.status,
        lateSec: secondsBetween(promise.due, promise.closedAt),
        snoozes: promise.snoozes,
        nags: promise.nagCount,
      },
      title: promise.title,
    },
  ];
}

function emitPromise(row: PromiseRow): void {
  appendEvent("promise", row.fields, {
    id: row.id,
    ts: row.ts,
    session: null,
    channel: null,
    cwd: "",
    project: row.project,
    attribution: { machine: "unknown", actor: "unknown", runtime: "unknown" },
    content: { title: row.title },
  });
}

/** Appends the promises not yet logged and returns how many events. */
export function backfillPromises(known: Set<string>, since?: string): number {
  const rows = readPromises().flatMap((promise) => [made(promise), ...closed(promise)]);
  return emitUnseen(rows, (row) => row.id, emitPromise, known, since);
}
