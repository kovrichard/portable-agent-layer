/**
 * One sync run: take in what other machines uploaded, upload what this machine
 * wrote, then sign a fresh manifest. A run that changed anything leaves one
 * `sync` event in bronze, uploaded in the same run, so idle machines settle.
 */

import { appendEvent } from "../bronze/events";
import { loadMachine } from "../core/machine";
import { palHome } from "../core/paths";
import type { BlobStore } from "./blob-store";
import { emptyResult, type SyncContext, type SyncResult } from "./context";
import { fileKeys } from "./keys";
import { hostedFiles } from "./scope";
import { pullSegments, pushSegments, writeManifest } from "./segments";
import { readSyncState, writeSyncState } from "./state";
import { pullWhole, pushWhole } from "./whole";

export type SyncPhase = "upload-logs" | "take-in-logs" | "take-in-files" | "upload-files";

/** Runs one phase; its work resolves to how many items it moved, for a progress line. */
export type PhaseRunner = (
  phase: SyncPhase,
  work: () => Promise<number>
) => Promise<void>;

const quietly: PhaseRunner = async (_phase, work) => {
  await work();
};

export interface SyncOptions {
  store: BlobStore;
  account: Uint8Array<ArrayBuffer>;
  home?: string;
  machine?: string;
  phase?: PhaseRunner;
}

const changedAnything = (result: SyncResult) =>
  result.pushed > 0 ||
  result.pulled > 0 ||
  result.written.length > 0 ||
  result.quarantined.length > 0 ||
  result.refused.length > 0;

const pathsOf = (ctx: SyncContext, kind: "segments" | "whole") =>
  hostedFiles(ctx.home)
    .filter((file) => file.kind === kind)
    .map((file) => file.path);

/**
 * Segments go up before others' lines are appended, so the upload cursor sits
 * at the end of the file and skips them; whole files come down first, so a
 * change on both machines is seen before either is uploaded.
 */
async function exchange(ctx: SyncContext, phase: PhaseRunner): Promise<void> {
  const { result } = ctx;
  const counted = (count: () => number, work: () => Promise<void>) => async () => {
    const before = count();
    await work();

    return count() - before;
  };
  const uploads = () => result.pushed;

  await phase(
    "upload-logs",
    counted(uploads, () => pushSegments(ctx, pathsOf(ctx, "segments")))
  );
  await phase(
    "take-in-logs",
    counted(
      () => result.pulled,
      () => pullSegments(ctx)
    )
  );
  await phase(
    "take-in-files",
    counted(
      () => result.written.length,
      () => pullWhole(ctx)
    )
  );
  await phase(
    "upload-files",
    counted(uploads, () => pushWhole(ctx, pathsOf(ctx, "whole")))
  );
}

function logRun(result: SyncResult): void {
  appendEvent("sync", {
    pushed: result.pushed,
    pulled: result.pulled,
    written: result.written.length,
    quarantined: result.quarantined,
    refused: result.refused,
  });
}

export async function syncOnce(options: SyncOptions): Promise<SyncResult> {
  const home = options.home ?? palHome();
  const ctx: SyncContext = {
    home,
    store: options.store,
    account: options.account,
    machine: options.machine ?? loadMachine(home).id,
    keys: fileKeys(options.store, options.account),
    state: readSyncState(home),
    result: emptyResult(),
  };
  await exchange(ctx, options.phase ?? quietly);

  if (changedAnything(ctx.result)) {
    logRun(ctx.result);
    await pushSegments(ctx, pathsOf(ctx, "segments"));
    await writeManifest(ctx);
  }

  writeSyncState(home, ctx.state);

  return ctx.result;
}
