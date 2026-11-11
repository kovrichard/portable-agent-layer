import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectExportFiles } from "../src/hooks/lib/export";
import { testHome } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = testHome(import.meta.file, `home-${crypto.randomUUID()}`);
  process.env.PAL_HOME = home;
  mkdirSync(resolve(home, "memory", "state", "transcript-handoff"), { recursive: true });
  writeFileSync(resolve(home, "memory", "state", "transcript-handoff", "s1.txt"), "x");
  writeFileSync(resolve(home, "memory", "state", "kept.json"), "{}");
});

describe("the export and transcript hand-off files", () => {
  test("a transcript hand-off file is not exported", () => {
    expect(collectExportFiles().some((f) => f.includes("transcript-handoff"))).toBe(
      false
    );
  });

  test("the rest of memory/state is still exported", () => {
    expect(collectExportFiles()).toContain("memory/state/kept.json");
  });
});
