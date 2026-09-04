import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// appendNotes deduplicates against what today's file already holds, so the count
// it was handed is not the count that landed. The receipt reports the truth, which
// is only possible if appendNotes returns it.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-rel-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/relationship");
}

describe("appendNotes reports what actually landed", () => {
  test("returns the file it wrote and the number written", async () => {
    const { appendNotes } = await lib();
    const result = appendNotes([{ type: "W", text: "a world fact" }]);
    expect(result.written).toBe(1);
    expect(result.file).toContain("relationship");
    expect(result.file.endsWith(".md")).toBe(true);
  });

  test("counts only fresh notes when a duplicate is dropped", async () => {
    const { appendNotes } = await lib();
    appendNotes([{ type: "W", text: "same fact" }]);
    const second = appendNotes([
      { type: "W", text: "same fact" },
      { type: "W", text: "a new fact" },
    ]);
    expect(second.written).toBe(1);
  });

  test("returns written 0 when every note is a duplicate", async () => {
    const { appendNotes } = await lib();
    appendNotes([{ type: "W", text: "only fact" }]);
    expect(appendNotes([{ type: "W", text: "only fact" }]).written).toBe(0);
  });

  test("returns written 0 for an empty batch, still naming the file", async () => {
    const { appendNotes } = await lib();
    const result = appendNotes([]);
    expect(result.written).toBe(0);
    expect(result.file.endsWith(".md")).toBe(true);
  });
});
