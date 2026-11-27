import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eventsSince } from "../src/bronze/events";
import { syncCommandWith } from "../src/cli/sync";
import { palPkg } from "../src/core/paths";
import { startSyncIfDue } from "../src/hooks/lib/sync-trigger";
import { accountKeyFile, readAccount, storeConfigOf } from "../src/sync/account";
import type { SyncResult } from "../src/sync/context";
import { randomKey } from "../src/sync/crypto";
import { formatRecoveryKey } from "../src/sync/recovery-key";
import { runSync, type SyncRun } from "../src/sync/run";
import { hostedFiles } from "../src/sync/scope";
import { syncStateDir } from "../src/sync/state";
import { runCommand } from "../src/tools/lib/command";
import { freshTestDir } from "./lib/test-home";

const GOALS = "telos/GOALS.md";
const KEY_LINE = /^ {2}([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/gm;

let dir: string;
let bucket: string;
const homes = { A: "", B: "" };
type Machine = keyof typeof homes;

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  bucket = resolve(dir, "bucket");
  homes.A = resolve(dir, "a");
  homes.B = resolve(dir, "b");
});

function put(machine: Machine, path: string, text: string): void {
  const file = resolve(homes[machine], path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

async function cli(
  machine: Machine,
  args: string[],
  recoveryKey: string | Error = "",
  sync: (home: string) => Promise<SyncRun> = runSync
) {
  process.env.PAL_HOME = homes[machine];
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };
  const log = spyOn(console, "log").mockImplementation(capture);
  const error = spyOn(console, "error").mockImplementation(capture);

  try {
    const command = syncCommandWith({
      home: () => homes[machine],
      readRecoveryKey: async () => {
        if (recoveryKey instanceof Error) throw recoveryKey;

        return recoveryKey;
      },
      sync,
    });
    const code = await runCommand(command, args, ["pal", "cli", "sync"]);

    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const keyIn = (out: string) => (out.match(KEY_LINE) ?? []).map((l) => l.trim()).join("-");

const NOT_SET_UP =
  "Sync is not set up on this machine: pal cli sync setup --store <where>";
const accountFileOf = (home: string) => resolve(syncStateDir(home), "account.json");

function kitPage(key: string, store: string): string {
  const groups = key.split("-");

  return [
    "PAL sync recovery key",
    "",
    `  ${groups.slice(0, 7).join("-")}`,
    `  ${groups.slice(7).join("-")}`,
    "",
    "It is the only way to add another machine, or to get your synced memory back",
    "if you lose every machine. Nobody can reset it, PAL included.",
    "",
    `Store: ${store}`,
    `Add a machine: pal cli sync join --store "${store}"`,
    "(on that machine, the path where it reaches the same folder)",
  ].join("\n");
}

const synced = (result: Partial<SyncResult>) => async (): Promise<SyncRun> => ({
  outcome: "synced",
  result: { pushed: 0, pulled: 0, written: [], quarantined: [], refused: [], ...result },
});

async function setUpA() {
  const setup = await cli("A", ["setup", "--store", bucket]);
  expect(setup.code).toBe(0);

  return keyIn(setup.out);
}

describe("setup and join", () => {
  test("a second machine joins with the recovery key and ends with the first one's memory", async () => {
    put("A", GOALS, "Ship sync.\n");
    const key = await setUpA();
    await cli("A", []);
    const join = await cli("B", ["join", "--store", bucket], key);

    expect(join.code).toBe(0);
    expect(join.out).toStartWith(
      "Joined. The first sync runs now; later ones run on their own.\nSynced:"
    );
    expect(readFileSync(resolve(homes.B, GOALS), "utf-8")).toBe("Ship sync.\n");
    expect(readAccount(homes.B)?.key).toEqual(readAccount(homes.A)?.key);
    expect(readAccount(homes.B)?.store).toEqual({ kind: "dir", path: bucket });
  });

  test("setup prints the key in two lines of seven groups, and recovery-key prints it again", async () => {
    const key = await setUpA();

    expect(key).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(keyIn((await cli("A", ["recovery-key"])).out)).toBe(key);
  });

  test("setup prints the whole kit, and --kit also writes it as a page", async () => {
    const kit = resolve(dir, "kit.txt");
    const setup = await cli("A", ["setup", "--store", bucket, "--kit", kit]);
    const page = kitPage(keyIn(setup.out), bucket);

    expect(setup.out).toBe(
      `Sync is set up.\n\n${page}\n\nWrote the page to ${kit}. Print it, then delete the file.`
    );
    expect(readFileSync(kit, "utf-8")).toBe(`${page}\n`);
    expect((await cli("A", ["recovery-key"])).out).toBe(page);
  });

  test.skipIf(process.platform === "win32")(
    "the kit page is for its owner alone",
    async () => {
      const kit = resolve(dir, "kit.txt");
      await cli("A", ["setup", "--store", bucket, "--kit", kit]);

      expect(statSync(kit).mode & 0o777).toBe(0o600);
    }
  );

  test("without --kit, setup writes no page", async () => {
    expect((await cli("A", ["setup", "--store", bucket])).out).not.toContain("Wrote");
  });

  test("recovery-key on a machine that is not set up says how to set it up", async () => {
    expect((await cli("A", ["recovery-key"])).out).toBe(NOT_SET_UP);
  });

  test("a machine already set up cannot join", async () => {
    const key = await setUpA();

    expect((await cli("A", ["join", "--store", bucket], key)).out).toContain(
      "already set up on this machine"
    );
  });

  test("a failure that is not about the account or the key is not passed off as a usage error", async () => {
    await expect(
      cli("B", ["join", "--store", bucket], new Error("stdin closed"))
    ).rejects.toThrow("stdin closed");
  });

  test("a second setup on the same store is refused and leaves that machine unset", async () => {
    await setUpA();
    const second = await cli("B", ["setup", "--store", bucket]);

    expect(second.code).not.toBe(0);
    expect(second.out).toContain("already holds an account");
    expect(readAccount(homes.B)).toBeNull();
    expect(existsSync(accountKeyFile(homes.B))).toBe(false);
  });

  test("a key from another account is refused before anything syncs", async () => {
    put("A", GOALS, "Ship sync.\n");
    await setUpA();
    await cli("A", []);
    const join = await cli(
      "B",
      ["join", "--store", bucket],
      formatRecoveryKey(randomKey())
    );

    expect(join.out).toContain("does not open the store's account");
    expect(readAccount(homes.B)).toBeNull();
    expect(existsSync(resolve(homes.B, GOALS))).toBe(false);
  });

  test("a typo in the key is named as a typo", async () => {
    const key = await setUpA();
    const typo = `${key.slice(0, 5)}${key[5] === "7" ? "8" : "7"}${key.slice(6)}`;

    expect((await cli("B", ["join", "--store", bucket], typo)).out).toContain("typo");
    expect(readAccount(homes.B)).toBeNull();
  });

  test("joining a folder no machine set up says to run setup", async () => {
    const join = await cli(
      "B",
      ["join", "--store", bucket],
      formatRecoveryKey(randomKey())
    );

    expect(join.out).toContain("holds no account yet");
  });

  test("setting up a machine twice is refused", async () => {
    await setUpA();

    expect((await cli("A", ["setup", "--store", resolve(dir, "other")])).out).toContain(
      "already set up on this machine"
    );
  });

  test("setup and join are decisions in bronze", async () => {
    const key = await setUpA();
    await cli("B", ["join", "--store", bucket], key);

    expect(eventsSince("sync_account", new Date(0)).map((e) => e.action)).toEqual([
      "join",
    ]);
    process.env.PAL_HOME = homes.A;
    expect(eventsSince("sync_account", new Date(0)).map((e) => e.action)).toEqual([
      "setup",
    ]);
  });

  test("--store is required", async () => {
    expect((await cli("A", ["setup"])).out).toContain("Pass --store");
  });

  test("--store takes a file:// URL for the same folder as its path", async () => {
    const key = await setUpA();
    const join = await cli("B", ["join", "--store", pathToFileURL(bucket).href], key);

    expect(join.code).toBe(0);
    expect(readAccount(homes.B)?.store).toEqual({ kind: "dir", path: bucket });
  });

  test("a folder path with :// inside it is still a folder", () => {
    expect(storeConfigOf("/mnt/a://b", (p) => p)).toEqual({
      kind: "dir",
      path: "/mnt/a://b",
    });
  });

  test.each([
    ["s3:///pal", "name the bucket"],
    ["ftp://host/pal", 'unknown store "ftp://"'],
  ])("--store %s is refused, saying why", async (where, reason) => {
    const setup = await cli("A", ["setup", "--store", where]);

    expect(setup.code).not.toBe(0);
    expect(setup.out).toContain(reason);
  });
});

describe("the account key stays on its machine", () => {
  test("it is not among the synced files, before or after the state move", async () => {
    put("A", "memory/state/sessions.json", "{}");
    await setUpA();

    expect(hostedFiles(homes.A).map((f) => f.path)).not.toContainEqual(
      expect.stringContaining("account")
    );
    expect(accountKeyFile(homes.A)).toBe(
      resolve(homes.A, "memory/state/sync/account.key")
    );
  });

  test.skipIf(process.platform === "win32")("only its owner can read it", async () => {
    await setUpA();

    expect(statSync(accountKeyFile(homes.A)).mode & 0o777).toBe(0o600);
  });

  test("an account file without its key is no account", () => {
    mkdirSync(syncStateDir(homes.B), { recursive: true });
    writeFileSync(
      accountFileOf(homes.B),
      JSON.stringify({ store: { kind: "dir", path: bucket } })
    );

    expect(readAccount(homes.B)).toBeNull();
  });

  test("a broken account file is named", async () => {
    await setUpA();
    writeFileSync(accountFileOf(homes.A), "{");

    expect(() => readAccount(homes.A)).toThrow("the sync account file is not valid JSON");
  });
});

describe("status", () => {
  test("on a machine that is not set up says how to set it up", async () => {
    expect((await cli("A", ["status"])).out).toBe(NOT_SET_UP);
  });

  test("names the store, the last sync that changed anything and the quarantine", async () => {
    await setUpA();

    expect((await cli("A", ["status"])).out).toBe(
      `Store: folder ${bucket}\nLast sync that changed anything: none in 30 days\nIn quarantine: 0 file(s)`
    );

    put("A", GOALS, "Ship sync.\n");
    put("A", "backups/sync-quarantine/telos/GOALS.md.v2", "old");
    put("A", "backups/sync-quarantine/telos/IDEAS.md.local", "old");
    await cli("A", []);
    const last = eventsSince("sync", new Date(0)).at(-1)?.ts;

    expect((await cli("A", ["status"])).out).toBe(
      `Store: folder ${bucket}\nLast sync that changed anything: ${last}\nIn quarantine: 2 file(s)`
    );
  });
});

describe("sync runs", () => {
  test("say so on a machine that is not set up", async () => {
    expect(await runSync(homes.A)).toEqual({ outcome: "not-set-up" });
    expect((await cli("A", [])).out).toContain("pal cli sync setup");
  });

  test("never two at once: a lock is busy until it is ten minutes old, then taken over", async () => {
    await setUpA();
    const lock = resolve(syncStateDir(homes.A), "sync.lock");
    const lockedAt = Math.floor(Date.now() / 1000) * 1000;
    writeFileSync(lock, "1");
    utimesSync(lock, lockedAt / 1000, lockedAt / 1000);

    expect(await runSync(homes.A, undefined, lockedAt + 10 * 60_000 - 1)).toEqual({
      outcome: "busy",
    });
    expect((await runSync(homes.A, undefined, lockedAt + 10 * 60_000)).outcome).toBe(
      "synced"
    );
    expect(existsSync(lock)).toBe(false);
  });

  test("an update to a file this machine left alone replaces it without quarantine", async () => {
    put("A", GOALS, "Ship sync.\n");
    const key = await setUpA();
    await cli("A", []);
    await cli("B", ["join", "--store", bucket], key);
    put("A", GOALS, "Ship sync twice.\n");
    await cli("A", []);
    await cli("B", []);

    expect(readFileSync(resolve(homes.B, GOALS), "utf-8")).toBe("Ship sync twice.\n");
    expect(existsSync(resolve(homes.B, "backups/sync-quarantine"))).toBe(false);
  });

  test("print what a run did, and fail when something was refused", async () => {
    expect(await cli("A", [], "", synced({}))).toEqual({
      code: 0,
      out: "Synced: 0 uploaded, 0 line(s) taken in, 0 file(s) written",
    });
    expect(
      await cli(
        "A",
        ["run"],
        "",
        synced({
          pushed: 2,
          pulled: 3,
          written: ["a", "b"],
          quarantined: ["x", "y"],
          refused: ["z"],
        })
      )
    ).toEqual({
      code: 1,
      out: "Synced: 2 uploaded, 3 line(s) taken in, 2 file(s) written, 2 in quarantine: x, y, refused: z",
    });
  });

  test("say so when another run holds the machine", async () => {
    expect(await cli("A", [], "", async () => ({ outcome: "busy" }))).toEqual({
      code: 0,
      out: "Another sync is running on this machine.",
    });
  });
});

describe("the trigger", () => {
  const started: string[][] = [];
  const trigger = (moment: "start" | "turn" | "end", now: number) =>
    startSyncIfDue(moment, { home: homes.A, now, start: (c) => started.push(c) });

  beforeEach(() => {
    started.length = 0;
  });

  test("starts nothing on a machine that is not set up", () => {
    mkdirSync(syncStateDir(homes.A), { recursive: true });

    expect(trigger("start", Date.now())).toBe(false);
    expect(started).toEqual([]);
  });

  test("starts nothing when the account file is broken", async () => {
    await setUpA();
    writeFileSync(accountFileOf(homes.A), "{");

    expect(trigger("start", Date.now())).toBe(false);
    expect(started).toEqual([]);
  });

  test("after a turn, at most every 15 minutes; at start and end, always", async () => {
    await setUpA();
    const t0 = Date.now();
    const quarter = 15 * 60_000;

    expect(trigger("turn", t0)).toBe(true);
    expect(trigger("turn", t0 + quarter - 1)).toBe(false);
    expect(trigger("end", t0 + 60_000)).toBe(true);
    expect(trigger("start", t0 + 60_000)).toBe(true);
    expect(trigger("turn", t0 + 60_000 + quarter - 1)).toBe(false);
    expect(trigger("turn", t0 + 60_000 + quarter)).toBe(true);
    expect(started).toEqual(
      new Array(4).fill([resolve(palPkg(), "src", "cli", "index.ts"), "cli", "sync"])
    );
  });

  test("syncs this install's home when no home is given", async () => {
    await setUpA();
    process.env.PAL_HOME = homes.A;

    expect(
      startSyncIfDue("start", { now: Date.now(), start: (c) => started.push(c) })
    ).toBe(true);
  });
});
