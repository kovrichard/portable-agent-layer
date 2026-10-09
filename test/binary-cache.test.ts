import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canInfer } from "../src/hooks/lib/inference";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";

const KEYS = ["PATH", "PAL_AGENT", "PAL_ANTHROPIC_API_KEY"] as const;
let saved: Record<string, string | undefined>;
let emptyBin: string;
let claudeBin: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_ANTHROPIC_API_KEY;
  emptyBin = mkdtempSync(resolve(tmpdir(), "pal-no-claude-"));
  claudeBin = mkdtempSync(resolve(tmpdir(), "pal-with-claude-"));
  writeFakeBin(claudeBin, "claude", "process.exit(0);");
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  removeOnceReleased(emptyBin);
  removeOnceReleased(claudeBin);
});

test("a binary lookup is not reused under a different PATH", () => {
  process.env.PATH = emptyBin;
  expect(canInfer()).toBe(false);
  prependPath(claudeBin);
  expect(canInfer()).toBe(true);
  process.env.PATH = emptyBin;
  expect(canInfer()).toBe(false);
});
