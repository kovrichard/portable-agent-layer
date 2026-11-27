/**
 * Every other file travels whole, as numbered versions under
 * `whole/<fileId>/<version>`; the version number is claimed with a put that
 * refuses to replace, so two machines never both write the same version.
 * Once a version is agreed, a file both machines changed keeps the local copy
 * and quarantines the incoming one. Before any agreement, on a machine's first
 * sync, the account's copy wins and the local one is quarantined: a joining
 * machine's newest files are often the templates `pal cli init` just wrote.
 * Quarantined copies sit under backups/sync-quarantine/ until the user merges them.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { recordAdoptedActor } from "../bronze/actor-adoption";
import { ACTOR_PATH } from "../core/actor";
import { orRefuse, type SyncContext, SyncRefusal } from "./context";
import { fileId, openBlob, sealBlob } from "./crypto";
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

  if (local && !unchangedHere && path !== ACTOR_PATH)
    quarantine(ctx, path, local, "local");
  writeFile(file, incoming);

  if (local && path === ACTOR_PATH) recordAdoptedActor(local.toString("utf-8"), ctx.home);
  ctx.result.written.push(path);
  ctx.state.whole[path] = { hash: incomingHash, version };
}

/**
 * A file that became local-only after a machine had uploaded it. Its path is
 * authenticated by the account key, so the blob came from one of the user's own
 * machines: it is left unread, and its version noted so later runs skip it.
 */
function leaveLocal(ctx: SyncContext, path: string, version: number): void {
  ctx.state.whole[path] = { hash: ctx.state.whole[path]?.hash ?? "", version };
}

async function pullFile(ctx: SyncContext, id: string, version: number): Promise<void> {
  const { path, dataKey } = await ctx.keys.forId(id);
  const kind = syncKindOf(path);

  if (kind === null) return leaveLocal(ctx, path, version);

  if (kind !== "whole") throw new SyncRefusal("out-of-scope");

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

/** Keyed by file id, computed here, so a file already in step costs no request. */
async function agreedVersionsById(ctx: SyncContext): Promise<Map<string, number>> {
  const byId = new Map<string, number>();

  for (const [path, { version }] of Object.entries(ctx.state.whole))
    byId.set(await fileId(ctx.account, path), version);

  return byId;
}

export async function pullWhole(ctx: SyncContext): Promise<void> {
  const agreed = await agreedVersionsById(ctx);

  for (const [id, version] of latestVersions(await ctx.store.list("whole/"))) {
    if (version <= (agreed.get(id) ?? 0)) continue;
    await orRefuse(ctx, id, () => pullFile(ctx, id, version));
  }
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
