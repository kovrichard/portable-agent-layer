import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import * as realDetached from "../src/hooks/lib/detached-inference";
import { sandboxContextRuleDirs } from "./lib/context-rule-dirs";
import { freshTestDir } from "./lib/test-home";

type Spawned = { scriptPath: string; args: string[]; scope: string };
let spawned: Spawned[] = [];
let recording = false;

mock.module("../src/hooks/lib/detached-inference", () => ({
  ...realDetached,
  spawnDetachedInference: (scriptPath: string, args: string[], scope: string) => {
    if (!recording) return realDetached.spawnDetachedInference(scriptPath, args, scope);
    spawned.push({ scriptPath, args, scope });
  },
}));

const { runStopHandlers } = await import("../src/hooks/lib/stop");

const HOUR = 3_600_000;
const savedTmpdir = process.env.TMPDIR;
let home: string;
let osTmp: string;
let restoreRules: (() => void) | undefined;

const messages = Array.from({ length: 8 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `message ${i} `.repeat(50),
}));

function handoffDir(): string {
  return resolve(home, "memory", "state", "transcript-handoff");
}

function ageFile(file: string, hoursAgo: number): void {
  const when = new Date(Date.now() - hoursAgo * HOUR);
  utimesSync(file, when, when);
}

beforeEach(() => {
  restoreRules?.();
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
  home = freshTestDir(import.meta.file);
  osTmp = resolve(home, "os-tmp");
  mkdirSync(osTmp, { recursive: true });
  process.env.PAL_HOME = home;
  process.env.TMPDIR = osTmp;
  process.env.TMP = osTmp;
  process.env.TEMP = osTmp;
  restoreRules = sandboxContextRuleDirs(resolve(home, "agents"));
  spawned = [];
  recording = true;
});

describe("Stop hook transcript hand-off folder", () => {
  test("writes one flat file per child in PAL_HOME and nothing to the OS temp folder", async () => {
    await runStopHandlers(messages, { sessionId: "handoff-1" });

    const dir = handoffDir();
    expect(existsSync(dir)).toBe(true);
    const entries = readdirSync(dir);
    expect(entries.length).toBe(2);
    for (const name of entries) expect(statSync(resolve(dir, name)).isFile()).toBe(true);

    const paths = spawned
      .filter(
        (s) => s.scope === "session-intelligence" || s.scope === "entity-extraction"
      )
      .map((s) => s.args[2]);
    expect(paths.length).toBe(2);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) {
      expect(resolve(p, "..")).toBe(dir);
      expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual(
        JSON.parse(JSON.stringify(messages))
      );
    }

    expect(readdirSync(osTmp).filter((n) => n.startsWith("pal-transcript-"))).toEqual([]);
  });

  test("deletes hand-off files older than 24h and leaves younger ones", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const old = resolve(handoffDir(), "old.txt");
    const young = resolve(handoffDir(), "young.txt");
    writeFileSync(old, "old");
    writeFileSync(young, "young");
    ageFile(old, 25);
    ageFile(young, 1);

    await runStopHandlers(messages, { sessionId: "handoff-sweep" });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  test("a second run removes nothing young and only adds its own two files", async () => {
    mkdirSync(handoffDir(), { recursive: true });
    const old = resolve(handoffDir(), "old.txt");
    const young = resolve(handoffDir(), "young.txt");
    writeFileSync(old, "old");
    writeFileSync(young, "young");
    ageFile(old, 48);
    ageFile(young, 2);

    await runStopHandlers(messages, { sessionId: "handoff-twice" });
    const afterFirst = readdirSync(handoffDir()).sort();
    expect(afterFirst).not.toContain("old.txt");
    expect(afterFirst).toContain("young.txt");

    await runStopHandlers(messages, { sessionId: "handoff-twice" });
    const afterSecond = readdirSync(handoffDir()).sort();
    for (const name of afterFirst) expect(afterSecond).toContain(name);
    expect(afterSecond).toContain("young.txt");
    expect(afterSecond.length).toBe(afterFirst.length + 2);
  });

  test("returns without throwing when the hand-off folder is a regular file", async () => {
    mkdirSync(resolve(home, "memory", "state"), { recursive: true });
    writeFileSync(handoffDir(), "not a folder");

    await runStopHandlers(messages, { sessionId: "handoff-broken" });

    expect(statSync(handoffDir()).isFile()).toBe(true);
    expect(readdirSync(osTmp).filter((n) => n.startsWith("pal-transcript-"))).toEqual([]);
    expect(spawned.filter((s) => s.scope !== "agenda")).toEqual([]);
  });
});

describe("detached children delete their hand-off file", () => {
  const children = ["session-intelligence", "entity-extraction"] as const;
  const handlers = resolve(import.meta.dir, "../src/hooks/handlers");

  beforeEach(() => {
    recording = false;
  });

  async function runChild(name: string, content: string): Promise<string> {
    const dir = freshTestDir(import.meta.file);
    mkdirSync(resolve(dir, "memory", "state"), { recursive: true });
    const file = resolve(dir, "handoff.txt");
    writeFileSync(file, content);
    const proc = Bun.spawn(
      [process.execPath, resolve(handlers, `${name}.ts`), "--run", "sid-child", file],
      {
        env: {
          ...process.env,
          PAL_HOME: dir,
          PAL_INFERENCE_DISABLED: "1",
          PAL_AGENT: "codex",
        },
        stdout: "ignore",
        stderr: "ignore",
      }
    );
    await proc.exited;
    return file;
  }

  for (const name of children) {
    test(`${name} removes the file after a normal run`, async () => {
      const file = await runChild(name, JSON.stringify(messages));
      expect(existsSync(file)).toBe(false);
    }, 30_000);

    test(`${name} removes the file when its work throws`, async () => {
      const file = await runChild(name, "{ this is not json");
      expect(existsSync(file)).toBe(false);
    }, 30_000);
  }
});
