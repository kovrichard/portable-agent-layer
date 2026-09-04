import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { emit } from "../src/tools/lib/emit";

// emit gates ok()/note() on verbosity (TTY or PAL_VERBOSE), never data().
// isVerbose() reads process.env + process.stdout.isTTY per call, so we drive
// both here and capture what actually reaches stdout.

const originalWrite = process.stdout.write.bind(process.stdout);
const originalIsTTY = process.stdout.isTTY;
const originalVerbose = process.env.PAL_VERBOSE;
const originalQuiet = process.env.PAL_QUIET;

let captured: string[];

function captureStdout(): void {
  captured = [];
  process.stdout.write = (chunk: string) => {
    captured.push(String(chunk));
    return true;
  };
}

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  captureStdout();
  process.env.PAL_VERBOSE = undefined;
  process.env.PAL_QUIET = undefined;
  delete process.env.PAL_VERBOSE;
  delete process.env.PAL_QUIET;
});

afterEach(() => {
  process.stdout.write = originalWrite;
  setTTY(originalIsTTY);
  if (originalVerbose === undefined) delete process.env.PAL_VERBOSE;
  else process.env.PAL_VERBOSE = originalVerbose;
  if (originalQuiet === undefined) delete process.env.PAL_QUIET;
  else process.env.PAL_QUIET = originalQuiet;
});

describe("emit.data", () => {
  test("always emits, even when piped and quiet", () => {
    setTTY(undefined);
    process.env.PAL_QUIET = "1";
    emit.data("payload");
    expect(captured).toEqual(["payload\n"]);
  });

  test("appends a newline only when missing", () => {
    setTTY(undefined);
    emit.data("already\n");
    expect(captured).toEqual(["already\n"]);
  });
});

describe("emit.ok", () => {
  test("silent when piped (non-TTY, no overrides)", () => {
    setTTY(undefined);
    emit.ok("done");
    expect(captured).toEqual([]);
  });

  test("emit at a TTY", () => {
    setTTY(true);
    emit.ok("done");
    expect(captured).toEqual(["done\n"]);
  });

  test("PAL_VERBOSE forces output even when piped", () => {
    setTTY(undefined);
    process.env.PAL_VERBOSE = "1";
    emit.ok("done");
    expect(captured).toEqual(["done\n"]);
  });

  test("PAL_QUIET wins over a TTY", () => {
    setTTY(true);
    process.env.PAL_QUIET = "1";
    emit.ok("done");
    expect(captured).toEqual([]);
  });
});

describe("emit.receipt", () => {
  const originalHome = process.env.PAL_HOME;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = originalHome;
  });

  function receipt(): Record<string, unknown> {
    return JSON.parse(captured.join(""));
  }

  test("is NEVER gated — a write confirms itself even piped and quiet", () => {
    setTTY(undefined);
    process.env.PAL_QUIET = "1";
    process.env.PAL_HOME = "/tmp/pal-home";
    emit.receipt("/tmp/pal-home/memory/state/threads.jsonl");
    expect(receipt()).toEqual({ ok: true, wrote: "memory/state/threads.jsonl" });
  });

  test("reports the path relative to PAL_HOME, not an absolute home path", () => {
    setTTY(undefined);
    process.env.PAL_HOME = "/tmp/pal-home";
    emit.receipt(resolve("/tmp/pal-home", "memory", "actor.json"));
    expect(receipt().wrote).toBe("memory/actor.json");
  });

  test("keeps the full path for a file outside PAL_HOME", () => {
    setTTY(undefined);
    process.env.PAL_HOME = "/tmp/pal-home";
    emit.receipt("/var/log/elsewhere.jsonl");
    expect(receipt().wrote).toBe("/var/log/elsewhere.jsonl");
  });

  test("merges the operation's own fields into the receipt", () => {
    setTTY(undefined);
    process.env.PAL_HOME = "/tmp/pal-home";
    emit.receipt("/tmp/pal-home/notes.md", { written: 2, deduped: 1 });
    expect(receipt()).toEqual({
      ok: true,
      wrote: "notes.md",
      written: 2,
      deduped: 1,
    });
  });

  test("emits exactly one line, so a caller can parse it whole", () => {
    setTTY(undefined);
    process.env.PAL_HOME = "/tmp/pal-home";
    emit.receipt("/tmp/pal-home/notes.md", { written: 2 });
    expect(captured.join("").trimEnd().split("\n").length).toBe(1);
  });
});
