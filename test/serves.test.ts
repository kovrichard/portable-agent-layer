import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readProject } from "../src/hooks/lib/projects";
import {
  isImportant,
  isServesKind,
  SERVES_KINDS,
  SERVES_MEANING,
  setServes,
} from "../src/hooks/lib/serves";

// The override rule is the whole point of storing who decided, so it is pinned
// from both directions: a guess must not clobber an answer, an answer must
// clobber a guess.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-serves-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function isaPath(slug: string): string {
  return resolve(HOME, "memory", "projects", slug, "ISA.md");
}

function registerProject(slug: string, extraFrontmatter = ""): void {
  mkdirSync(resolve(HOME, "memory", "projects", slug), { recursive: true });
  const front = [
    `name: ${slug}`,
    "status: active",
    "created: 2026-08-01T00:00:00.000Z",
    "updated: 2026-09-01T00:00:00.000Z",
    extraFrontmatter,
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(isaPath(slug), `---\n${front}\n---\n\n## Goal\n\nnone\n`, "utf-8");
}

describe("the vocabulary", () => {
  test("there are exactly three answers", () => {
    expect(SERVES_KINDS).toEqual(["goal", "revenue", "fun"]);
    expect(Object.keys(SERVES_MEANING).sort()).toEqual(["fun", "goal", "revenue"]);
  });

  test("a goal and a revenue bet are important, fun and unknown are not", () => {
    expect(isImportant("goal")).toBe(true);
    expect(isImportant("revenue")).toBe(true);
    expect(isImportant("fun")).toBe(false);
    expect(isImportant(undefined)).toBe(false);
  });

  test("isServesKind refuses anything outside the three", () => {
    expect(isServesKind("revenue")).toBe(true);
    expect(isServesKind("important")).toBe(false);
    expect(isServesKind(null)).toBe(false);
    expect(isServesKind(1)).toBe(false);
  });
});

describe("setServes", () => {
  test("an unknown project is reported, not created", () => {
    expect(setServes({ name: "ghost", kind: "fun", by: "user" })).toBe("missing");
  });

  test("a guess lands on a record that has no answer", () => {
    registerProject("alpha");
    expect(
      setServes({ name: "alpha", kind: "revenue", note: "a SaaS bet", by: "inferred" })
    ).toBe("written");
    const stored = readProject("alpha");
    expect(stored?.serves).toBe("revenue");
    expect(stored?.serves_by).toBe("inferred");
    expect(stored?.serves_note).toBe("a SaaS bet");
  });

  test("a guess never overwrites the user's answer", () => {
    registerProject("alpha");
    setServes({ name: "alpha", kind: "fun", note: "mine", by: "user" });
    expect(setServes({ name: "alpha", kind: "goal", by: "inferred" })).toBe("kept");
    const stored = readProject("alpha");
    expect(stored?.serves).toBe("fun");
    expect(stored?.serves_by).toBe("user");
    expect(stored?.serves_note).toBe("mine");
  });

  test("the user overrules a guess", () => {
    registerProject("alpha");
    setServes({ name: "alpha", kind: "fun", by: "inferred" });
    expect(setServes({ name: "alpha", kind: "revenue", by: "user" })).toBe("written");
    expect(readProject("alpha")?.serves_by).toBe("user");
  });

  test("a later write with no note keeps the note already on record", () => {
    registerProject("alpha");
    setServes({ name: "alpha", kind: "fun", note: "a toy", by: "inferred" });
    setServes({ name: "alpha", kind: "revenue", by: "user" });
    expect(readProject("alpha")?.serves_note).toBe("a toy");
  });

  test("writing bumps updated — the record changed, so it ranks as touched", () => {
    registerProject("alpha");
    const before = readProject("alpha")?.updated;
    setServes({ name: "alpha", kind: "goal", by: "user" });
    const after = readProject("alpha")?.updated;
    expect(after).not.toBe(before);
    expect(Date.parse(after ?? "")).toBeGreaterThan(Date.parse(before ?? ""));
  });

  test("a refused guess changes nothing at all, timestamp included", () => {
    registerProject("alpha");
    setServes({ name: "alpha", kind: "fun", by: "user" });
    const before = readProject("alpha")?.updated;
    expect(setServes({ name: "alpha", kind: "goal", by: "inferred" })).toBe("kept");
    expect(readProject("alpha")?.updated).toBe(before);
  });

  test("the three keys land in frontmatter, flat", () => {
    registerProject("alpha");
    setServes({ name: "alpha", kind: "goal", note: "the pitch", by: "user" });
    const raw = readFileSync(isaPath("alpha"), "utf-8");
    expect(raw).toContain('serves: "goal"');
    expect(raw).toContain('serves_by: "user"');
    expect(raw).toContain('serves_note: "the pitch"');
  });
});
