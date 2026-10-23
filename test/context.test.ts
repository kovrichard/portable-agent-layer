import { beforeAll, describe, expect, test } from "bun:test";
import { buildSystemReminder } from "../src/hooks/lib/context";
import { freshTestDir } from "./lib/test-home";

// These are type-only smoke tests, so they need no real corpus — and reading the
// developer's own ~/.pal would let context assembly write into it (project reads
// seed bindings). A temp home keeps them deterministic and side-effect free.
let HOME: string;

beforeAll(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

describe("context builders", () => {
  test("buildSystemReminder returns string", () => {
    const result = buildSystemReminder();
    expect(typeof result).toBe("string");
    if (result) {
      expect(result).toContain("<system-reminder>");
      expect(result).toContain("</system-reminder>");
    }
  });
});
