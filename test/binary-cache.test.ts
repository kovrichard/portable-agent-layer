import { beforeEach, expect, test } from "bun:test";
import { canInfer } from "../src/hooks/lib/inference";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { freshTestDir } from "./lib/test-home";

let emptyBin: string;
let claudeBin: string;

beforeEach(() => {
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_ANTHROPIC_API_KEY;
  emptyBin = freshTestDir(import.meta.file);
  claudeBin = freshTestDir(import.meta.file);
  writeFakeBin(claudeBin, "claude", "process.exit(0);");
});

test("a binary lookup is not reused under a different PATH", () => {
  process.env.PATH = emptyBin;
  expect(canInfer()).toBe(false);
  prependPath(claudeBin);
  expect(canInfer()).toBe(true);
  process.env.PATH = emptyBin;
  expect(canInfer()).toBe(false);
});
