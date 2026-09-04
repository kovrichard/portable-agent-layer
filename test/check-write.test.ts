import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fingerprint, report, rewrittenBetween } from "../.agents/scripts/check-write";

// The formatter runs between an agent reading a file and editing it. What it
// rewrote is the difference between an edit that lands and one that fails on a
// stale snippet, so these cases are about detecting a rewrite exactly — never
// missing one, and never inventing one.

describe("fingerprint", () => {
  test("changes when the bytes change", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-fmt-"));
    const file = resolve(dir, "a.ts");
    try {
      writeFileSync(file, "const a=1", "utf-8");
      const before = fingerprint([file]);
      writeFileSync(file, "const a = 1;", "utf-8");
      expect(fingerprint([file]).get(file)).not.toBe(before.get(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A formatter that rewrote a file byte-identically must not be reported: an
  // output that cries wolf trains the reader to ignore it.
  test("is stable when a rewrite produced identical bytes", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pal-fmt-"));
    const file = resolve(dir, "a.ts");
    try {
      writeFileSync(file, "const a = 1;", "utf-8");
      const before = fingerprint([file]);
      writeFileSync(file, "const a = 1;", "utf-8");
      expect(fingerprint([file]).get(file)).toBe(before.get(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips a file it cannot read rather than throwing", () => {
    expect(fingerprint(["/definitely/not/here.ts"]).size).toBe(0);
  });
});

describe("rewrittenBetween", () => {
  const files = ["a.ts", "b.ts", "c.ts"];

  test("names only the files whose hash moved", () => {
    const before = new Map([
      ["a.ts", "1"],
      ["b.ts", "2"],
      ["c.ts", "3"],
    ]);
    const after = new Map([
      ["a.ts", "1"],
      ["b.ts", "CHANGED"],
      ["c.ts", "3"],
    ]);
    expect(rewrittenBetween(files, before, after)).toEqual(["b.ts"]);
  });

  test("reports nothing when the run changed nothing", () => {
    const same = new Map([
      ["a.ts", "1"],
      ["b.ts", "2"],
      ["c.ts", "3"],
    ]);
    expect(rewrittenBetween(files, same, same)).toEqual([]);
  });

  test("counts a file that appeared during the run", () => {
    const before = new Map([["a.ts", "1"]]);
    const after = new Map([
      ["a.ts", "1"],
      ["b.ts", "new"],
    ]);
    expect(rewrittenBetween(["a.ts", "b.ts"], before, after)).toEqual(["b.ts"]);
  });
});

describe("report", () => {
  test("states plainly that nothing moved", () => {
    expect(report([])).toContain("No files were rewritten");
  });

  test("names every file and tells the reader what to do about it", () => {
    const text = report(["src/a.ts", "src/b.ts"]);
    expect(text).toContain("(2)");
    expect(text).toContain("re-read before editing");
    expect(text).toContain("src/a.ts");
    expect(text).toContain("src/b.ts");
  });
});
