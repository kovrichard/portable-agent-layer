import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { palPkg } from "../src/hooks/lib/paths";
import { freshTestDir } from "./lib/test-home";

const guardedSpawnSync = childProcess.spawnSync;
let recording = false;
let spawned: unknown[][];

mock.module("node:child_process", () => ({
  ...childProcess,
  spawnSync: (...args: unknown[]) => {
    if (!recording) return (guardedSpawnSync as (...a: unknown[]) => unknown)(...args);
    spawned.push(args);

    return { status: 0 };
  },
}));

const { summarizeLatestSession } = await import("../src/cli/session-summary");

let projects: string;

beforeEach(() => {
  projects = freshTestDir(import.meta.file);
  spawned = [];
});

function summarize(): void {
  recording = true;

  try {
    summarizeLatestSession(projects);
  } finally {
    recording = false;
  }
}

function transcript(rel: string, lines: string[], ageSeconds = 0): string {
  const path = resolve(projects, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  const when = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(path, when, when);

  return path;
}

const line = (sessionId?: string) => JSON.stringify({ sessionId, type: "user" });

function summarizedSessions(): string[] {
  const script = resolve(palPkg(), "src", "tools", "session-summary.ts");

  return spawned.map(([command, args, options]) => {
    expect(command).toBe("bun");
    expect(options).toEqual({ stdio: "inherit" });
    const argv = args as string[];
    expect(argv.slice(0, 4)).toEqual(["run", script, "--", "--session"]);

    return argv[4];
  });
}

describe("summarizeLatestSession", () => {
  test("summarizes the session of the newest transcript across projects", () => {
    transcript("alpha/old.jsonl", [line("old")], 300);
    transcript("beta/new.jsonl", [line("earlier"), line("newest")], 10);
    transcript("beta/notes.txt", [line("not-a-transcript")]);
    writeFileSync(resolve(projects, "loose.jsonl"), line("loose"));
    summarize();
    expect(summarizedSessions()).toEqual(["newest"]);
  });

  test("does nothing when no project holds a transcript", () => {
    mkdirSync(resolve(projects, "empty"), { recursive: true });
    summarize();
    expect(spawned).toEqual([]);
  });

  test("does nothing when the last line names no session", () => {
    transcript("alpha/a.jsonl", [line("older-line"), line()]);
    summarize();
    expect(spawned).toEqual([]);
  });

  test("does nothing when the last line is not JSON", () => {
    transcript("alpha/a.jsonl", [line("older-line"), "{not json"]);
    summarize();
    expect(spawned).toEqual([]);
  });

  test("does nothing for an empty transcript", () => {
    const path = transcript("alpha/a.jsonl", []);
    writeFileSync(path, "");
    summarize();
    expect(spawned).toEqual([]);
  });
});
