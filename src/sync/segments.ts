/**
 * Append-only files travel as segments: each machine uploads only its own new
 * complete lines, under `seg/<machine>/<fileId>/<seq>`, and appends the lines
 * other machines uploaded that it lacks. No machine writes another's segments,
 * so there is nothing to conflict.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { linesNotIn } from "../core/import-merge";
import { orRefuse, type SyncContext, SyncRefusal } from "./context";
import {
  openBlob,
  type SignedManifest,
  sealBlob,
  signManifest,
  verifyManifest,
} from "./crypto";
import { syncKindOf } from "./scope";

const NEWLINE = 10;

/** The complete lines written since `from`; a line still being written waits for the next sync. */
function newLines(file: string, from: number): Buffer | null {
  const size = statSync(file).size;
  if (size < from) throw new SyncRefusal("shrunk");

  if (size === from) return null;
  const buffer = Buffer.alloc(size - from);
  const fd = openSync(file, "r");

  try {
    readSync(fd, buffer, 0, buffer.length, from);
  } finally {
    closeSync(fd);
  }

  const end = buffer.lastIndexOf(NEWLINE);

  return end < 0 ? null : buffer.subarray(0, end + 1);
}

async function pushFile(ctx: SyncContext, path: string): Promise<void> {
  const done = ctx.state.pushed[path] ?? { bytes: 0, seq: 0 };
  const lines = newLines(resolve(ctx.home, path), done.bytes);
  if (!lines) return;
  const { id, dataKey } = await ctx.keys.forPath(path);
  const seq = done.seq + 1;
  const place = { fileId: id, machine: ctx.machine, seq };
  await ctx.store.put(
    `seg/${ctx.machine}/${id}/${seq}`,
    await sealBlob(dataKey, new Uint8Array(lines), place)
  );
  ctx.state.pushed[path] = { bytes: done.bytes + lines.length, seq, id };
  ctx.result.pushed++;
}

export async function pushSegments(ctx: SyncContext, paths: string[]): Promise<void> {
  for (const path of paths) await orRefuse(ctx, path, () => pushFile(ctx, path));
}

export async function writeManifest(ctx: SyncContext): Promise<void> {
  const files = Object.fromEntries(
    Object.values(ctx.state.pushed)
      .filter((entry) => entry.id && entry.seq > 0)
      .map((entry) => [entry.id as string, entry.seq])
  );
  ctx.state.counter++;
  const signed = await signManifest(ctx.account, {
    machine: ctx.machine,
    counter: ctx.state.counter,
    files,
  });
  await ctx.store.put(
    `manifest/${ctx.machine}`,
    new TextEncoder().encode(JSON.stringify(signed))
  );
}

const isSyncEvent = (line: string) => line.includes('"type":"sync"');

/**
 * Appends the lines this file lacks. Lines appended here are not this machine's
 * own, so the upload cursor skips them when nothing local was waiting before them.
 */
function applyLines(ctx: SyncContext, path: string, id: string, text: string): boolean {
  const file = resolve(ctx.home, path);
  const local = existsSync(file) ? readFileSync(file, "utf-8") : "";
  if (local && !local.endsWith("\n")) return false;
  const added = linesNotIn(local, text);
  if (added.length === 0) return true;
  mkdirSync(dirname(file), { recursive: true });
  const appended = added.map((line) => `${line}\n`).join("");
  appendFileSync(file, appended);
  const before = Buffer.byteLength(local);
  const pushed = ctx.state.pushed[path] ?? { bytes: 0, seq: 0, id };

  if (pushed.bytes === before)
    ctx.state.pushed[path] = { ...pushed, bytes: before + Buffer.byteLength(appended) };
  ctx.result.pulled += added.filter((line) => !isSyncEvent(line)).length;

  return true;
}

async function pullFile(ctx: SyncContext, machine: string, id: string, seq: number) {
  const progress = `${machine}/${id}`;
  const from = ctx.state.applied[progress] ?? 0;
  if (seq <= from) return;
  const { path, dataKey } = await ctx.keys.forId(id);
  if (syncKindOf(path) !== "segments") throw new SyncRefusal("out-of-scope");
  let text = "";

  for (let s = from + 1; s <= seq; s++) {
    const blob = await ctx.store.get(`seg/${progress}/${s}`);
    if (!blob) throw new SyncRefusal("missing");
    text += new TextDecoder().decode(
      await openBlob(dataKey, blob, { fileId: id, machine, seq: s })
    );
  }

  if (applyLines(ctx, path, id, text)) ctx.state.applied[progress] = seq;
}

function parseManifest(raw: Uint8Array): SignedManifest {
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as SignedManifest;
  } catch {
    throw new SyncRefusal("tampered");
  }
}

async function pullMachine(ctx: SyncContext, machine: string): Promise<void> {
  const raw = await ctx.store.get(`manifest/${machine}`);
  if (!raw) throw new SyncRefusal("missing");
  const manifest = await verifyManifest(
    ctx.account,
    parseManifest(raw),
    ctx.state.seen[machine]
  );
  if (manifest.machine !== machine) throw new SyncRefusal("tampered");

  for (const [id, seq] of Object.entries(manifest.files))
    await orRefuse(ctx, `${machine}/${id}`, () => pullFile(ctx, machine, id, seq));
  ctx.state.seen[machine] = manifest.counter;
}

export async function pullSegments(ctx: SyncContext): Promise<void> {
  const machines = (await ctx.store.list("manifest/"))
    .map((name) => name.slice("manifest/".length))
    .filter((machine) => machine !== ctx.machine);

  for (const machine of machines)
    await orRefuse(ctx, machine, () => pullMachine(ctx, machine));
}
