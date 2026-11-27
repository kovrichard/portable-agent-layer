import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eventsSince } from "../src/bronze/events";
import { syncCommandWith } from "../src/cli/sync";
import { startSyncIfDue } from "../src/hooks/lib/sync-trigger";
import { accountKeyFile, readAccount } from "../src/sync/account";
import { randomKey } from "../src/sync/crypto";
import { formatRecoveryKey } from "../src/sync/recovery-key";
import { runSync } from "../src/sync/run";
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

async function cli(machine: Machine, args: string[], recoveryKey = "") {
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
      readRecoveryKey: async () => recoveryKey,
    });
    const code = await runCommand(command, args, ["pal", "cli", "sync"]);

    return { code, out: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

const keyIn = (out: string) => (out.match(KEY_LINE) ?? []).map((l) => l.trim()).join("-");

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
    expect(join.out).toContain("Synced:");
    expect(readFileSync(resolve(homes.B, GOALS), "utf-8")).toBe("Ship sync.\n");
    expect(readAccount(homes.B)?.key).toEqual(readAccount(homes.A)?.key);
  });

  test("setup prints the key in two lines of seven groups, and recovery-key prints it again", async () => {
    const key = await setUpA();

    expect(key).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(keyIn((await cli("A", ["recovery-key"])).out)).toBe(key);
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
  });

  test.each([
    ["s3://bucket/pal", "S3 stores are not supported yet"],
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
});

describe("sync runs", () => {
  test("say so on a machine that is not set up", async () => {
    expect(await runSync(homes.A)).toEqual({ outcome: "not-set-up" });
    expect((await cli("A", [])).out).toContain("pal cli sync setup");
  });

  test("never two at once: a fresh lock means busy, a stale one is taken over", async () => {
    await setUpA();
    const lock = resolve(syncStateDir(homes.A), "sync.lock");
    writeFileSync(lock, "1");

    expect(await runSync(homes.A)).toEqual({ outcome: "busy" });
    expect((await runSync(homes.A, Date.now() + 11 * 60_000)).outcome).toBe("synced");
    expect(existsSync(lock)).toBe(false);
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
    expect(trigger("start", Date.now())).toBe(false);
    expect(started).toEqual([]);
  });

  test("after a turn, at most every 15 minutes; at start and end, always", async () => {
    await setUpA();
    const t0 = Date.now();

    expect(trigger("turn", t0)).toBe(true);
    expect(trigger("turn", t0 + 14 * 60_000)).toBe(false);
    expect(trigger("end", t0 + 14 * 60_000)).toBe(true);
    expect(trigger("start", t0 + 14 * 60_000)).toBe(true);
    expect(trigger("turn", t0 + 30 * 60_000)).toBe(true);
    expect(started.length).toBe(4);
    expect(started[0]?.slice(-2)).toEqual(["cli", "sync"]);
  });
});
