/**
 * pal cli sync — end-to-end encrypted sync of this machine's memory with the
 * user's other machines, through a store that never sees a key or a path.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../bronze/events";
import { palHome, toPath } from "../core/paths";
import {
  AccountError,
  joinAccount,
  readAccount,
  type StoreConfig,
  setupAccount,
  storeConfigOf,
} from "../sync/account";
import type { SyncResult } from "../sync/context";
import {
  formatRecoveryKey,
  parseRecoveryKey,
  RecoveryKeyError,
} from "../sync/recovery-key";
import { runSync } from "../sync/run";
import { group, type Leaf, leaf, UsageError } from "../tools/lib/command";

export interface SyncDeps {
  home: () => string;
  readRecoveryKey: () => Promise<string>;
}

const NOT_SET_UP =
  "Sync is not set up on this machine: pal cli sync setup --store <where>";

const STORE_OPTION = {
  type: "string",
  value: "<where>",
  description:
    "Where both machines sync through: a folder they can both reach, or s3://…",
} as const;

function storeOf(where: string | undefined): StoreConfig {
  if (!where)
    throw new UsageError(
      "Pass --store <where>: a folder both machines can reach (a NAS mount, a synced folder)"
    );

  return storeConfigOf(where, toPath);
}

function kitText(recoveryKey: string, store: StoreConfig): string {
  const groups = recoveryKey.split("-");

  return [
    "PAL sync recovery key",
    "",
    `  ${groups.slice(0, 7).join("-")}`,
    `  ${groups.slice(7).join("-")}`,
    "",
    "It is the only way to add another machine, or to get your synced memory back",
    "if you lose every machine. Nobody can reset it, PAL included.",
    "",
    `Store: ${store.path}`,
    `Add a machine: pal cli sync join --store ${store.path}`,
    "(on that machine, the path where it reaches the same folder)",
  ].join("\n");
}

async function failsAsUsage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AccountError || err instanceof RecoveryKeyError)
      throw new UsageError(err.message);
    throw err;
  }
}

function setupLeaf(deps: SyncDeps): Leaf {
  return leaf({
    summary: "Create the sync account on this machine and print its recovery key",
    options: {
      store: STORE_OPTION,
      kit: {
        type: "string",
        value: "<file>",
        description: "Also write the recovery key as a page to print",
      },
    },
    run: async ({ values }) => {
      const store = await failsAsUsage(async () => storeOf(values.store));
      const key = await failsAsUsage(() => setupAccount(deps.home(), store));
      const text = kitText(formatRecoveryKey(key), store);
      console.log(`Sync is set up.\n\n${text}`);

      if (values.kit) {
        writeFileSync(toPath(values.kit), `${text}\n`, { mode: 0o600 });
        console.log(
          `\nWrote the page to ${toPath(values.kit)}. Print it, then delete the file.`
        );
      }
    },
  });
}

function joinLeaf(deps: SyncDeps): Leaf {
  return leaf({
    summary: "Join the sync account another machine set up, with its recovery key",
    options: { store: STORE_OPTION },
    run: async ({ values }) => {
      const store = await failsAsUsage(async () => storeOf(values.store));
      await failsAsUsage(async () =>
        joinAccount(deps.home(), store, parseRecoveryKey(await deps.readRecoveryKey()))
      );
      console.log("Joined. The first sync runs now; later ones run on their own.");

      return printRun(await runSync(deps.home()));
    },
  });
}

function described(result: SyncResult): string {
  const parts = [
    `${result.pushed} uploaded`,
    `${result.pulled} line(s) taken in`,
    `${result.written.length} file(s) written`,
  ];

  if (result.quarantined.length > 0)
    parts.push(
      `${result.quarantined.length} in quarantine: ${result.quarantined.join(", ")}`
    );

  if (result.refused.length > 0) parts.push(`refused: ${result.refused.join(", ")}`);

  return parts.join(", ");
}

function printRun(run: Awaited<ReturnType<typeof runSync>>): number {
  if (run.outcome === "not-set-up") {
    console.log(NOT_SET_UP);

    return 1;
  }

  if (run.outcome === "busy") {
    console.log("Another sync is running on this machine.");

    return 0;
  }

  console.log(`Synced: ${described(run.result)}`);

  return run.result.refused.length > 0 ? 1 : 0;
}

function runLeaf(deps: SyncDeps): Leaf {
  return leaf({
    summary: "Sync now",
    run: async () => printRun(await runSync(deps.home())),
  });
}

function quarantineCount(home: string): number {
  const dir = resolve(home, "backups", "sync-quarantine");

  return existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
        .length
    : 0;
}

function statusLeaf(deps: SyncDeps): Leaf {
  return leaf({
    summary: "Which store this machine syncs through, the last sync and the quarantine",
    run: () => {
      const account = readAccount(deps.home());
      if (!account) return console.log(NOT_SET_UP);
      const last = eventsSince("sync", new Date(Date.now() - 30 * 86_400_000)).at(-1);
      console.log(`Store: folder ${account.store.path}`);
      console.log(`Last sync that changed anything: ${last?.ts ?? "none in 30 days"}`);
      console.log(`In quarantine: ${quarantineCount(deps.home())} file(s)`);
    },
  });
}

function recoveryKeyLeaf(deps: SyncDeps): Leaf {
  return leaf({
    summary: "Print this account's recovery key again",
    run: () => {
      const account = readAccount(deps.home());
      if (!account) return console.log(NOT_SET_UP);
      console.log(kitText(formatRecoveryKey(account.key), account.store));
    },
  });
}

async function promptRecoveryKey(): Promise<string> {
  if (!process.stdin.isTTY) return await Bun.stdin.text();
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((done) =>
    rl.question("Recovery key: ", (answer) => {
      rl.close();
      done(answer);
    })
  );
}

export function syncCommandWith(deps: SyncDeps) {
  return group({
    summary: "End-to-end encrypted sync of your memory between your machines",
    fallback: "run",
    commands: {
      run: runLeaf(deps),
      setup: setupLeaf(deps),
      join: joinLeaf(deps),
      status: statusLeaf(deps),
      "recovery-key": recoveryKeyLeaf(deps),
    },
  });
}

export const syncCommand = syncCommandWith({
  home: () => palHome(),
  readRecoveryKey: promptRecoveryKey,
});
