import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectExportFiles } from "../src/core/export";
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

describe("the export and the data folders beside memory/", () => {
  beforeEach(() => {
    for (const [dir, file] of [
      ["records/ledger", "actions.jsonl"],
      ["records/raw/p", "t.gz"],
      ["work", "commitments.json"],
      ["state", "collector-cursors.json"],
    ]) {
      mkdirSync(resolve(home, dir), { recursive: true });
      writeFileSync(resolve(home, dir, file), "x");
    }
  });

  test("records/ and work/ travel", () => {
    expect(collectExportFiles()).toEqual(
      expect.arrayContaining(["records/ledger/actions.jsonl", "work/commitments.json"])
    );
  });

  test("raw transcripts and machine state stay on the machine", () => {
    const files = collectExportFiles();

    expect(files.some((f) => f.startsWith("records/raw/"))).toBe(false);
    expect(files.some((f) => f.startsWith("state/"))).toBe(false);
  });
});
