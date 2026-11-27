/**
 * Every other file travels whole, as numbered versions under
 * `whole/<fileId>/<version>`; the version number is claimed with a put that
 * refuses to replace, so two machines never both write the same version.
 * When both changed a file, the local copy stays and the other is quarantined
 * under backups/sync-quarantine/.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { recordAdoptedActor } from "../bronze/actor-adoption";
import { ACTOR_PATH } from "../core/actor";
import { orRefuse, type SyncContext, SyncRefusal } from "./context";
import { openBlob, sealBlob } from "./crypto";
import { syncKindOf } from "./scope";

const hashOf = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const wholePlace = (id: string, version: number) => ({
  fileId: id,
  machine: "whole",
  seq: version,
});

function writeFile(path: string, data: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function quarantine(
  ctx: SyncContext,
  path: string,
  data: Uint8Array,
  label: string
): void {
  writeFile(resolve(ctx.home, "backups", "sync-quarantine", `${path}.${label}`), data);
  ctx.result.quarantined.push(path);
}

/** Decides between the local copy and an incoming version; see the module comment. */
function settle(
  ctx: SyncContext,
  path: string,
  incoming: Uint8Array,
  version: number
): void {
  const file = resolve(ctx.home, path);
  const agreed = ctx.state.whole[path];
  const local = existsSync(file) ? readFileSync(file) : null;
  const incomingHash = hashOf(incoming);
  const unchangedHere = !local || hashOf(local) === agreed?.hash;

  if (local && hashOf(local) === incomingHash) {
    ctx.state.whole[path] = { hash: incomingHash, version };

    return;
  }

  if (agreed && !unchangedHere) {
    quarantine(ctx, path, incoming, `v${version}`);
    ctx.state.whole[path] = { hash: agreed.hash, version };

    return;
  }

  if (local && !unchangedHere) quarantine(ctx, path, local, "local");
  writeFile(file, incoming);

  if (local && path === ACTOR_PATH) recordAdoptedActor(local.toString("utf-8"), ctx.home);
  ctx.result.written.push(path);
  ctx.state.whole[path] = { hash: incomingHash, version };
}

async function pullFile(ctx: SyncContext, id: string, version: number): Promise<void> {
  const { path, dataKey } = await ctx.keys.forId(id);
  if (syncKindOf(path) !== "whole") throw new SyncRefusal("out-of-scope");

  if (version <= (ctx.state.whole[path]?.version ?? 0)) return;
  const blob = await ctx.store.get(`whole/${id}/${version}`);
  if (!blob) throw new SyncRefusal("missing");

  settle(ctx, path, await openBlob(dataKey, blob, wholePlace(id, version)), version);
}

function latestVersions(names: string[]): Map<string, number> {
  const latest = new Map<string, number>();

  for (const name of names) {
    const [, id, version] = name.split("/");
    latest.set(id, Math.max(latest.get(id) ?? 0, Number(version)));
  }

  return latest;
}

export async function pullWhole(ctx: SyncContext): Promise<void> {
  for (const [id, version] of latestVersions(await ctx.store.list("whole/")))
    await orRefuse(ctx, id, () => pullFile(ctx, id, version));
}

async function pushFile(ctx: SyncContext, path: string): Promise<void> {
  const data = readFileSync(resolve(ctx.home, path));
  const hash = hashOf(data);
  const agreed = ctx.state.whole[path];
  if (agreed?.hash === hash) return;
  const { id, dataKey } = await ctx.keys.forPath(path);
  const version = (agreed?.version ?? 0) + 1;
  const blob = await sealBlob(dataKey, new Uint8Array(data), wholePlace(id, version));

  if (!(await ctx.store.put(`whole/${id}/${version}`, blob, { ifAbsent: true }))) return;
  ctx.state.whole[path] = { hash, version };
  ctx.result.pushed++;
}

export async function pushWhole(ctx: SyncContext, paths: string[]): Promise<void> {
  for (const path of paths) await orRefuse(ctx, path, () => pushFile(ctx, path));
}
