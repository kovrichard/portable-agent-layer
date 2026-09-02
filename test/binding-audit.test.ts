import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ProjectProgress } from "../src/hooks/lib/projects";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-audit-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/projects");
}

function project(name: string, path?: string): ProjectProgress {
  return { name, path, status: "active", created: "2026-01-01", updated: "2026-01-01" };
}

function checkout(name: string): string {
  const dir = resolve(HOME, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("auditBindings", () => {
  test("says nothing when every project is where it claims to be", async () => {
    const { auditBindings } = await lib();
    expect(auditBindings([project("alpha", checkout("alpha"))], {})).toEqual([]);
  });

  test("reports a project it cannot locate at all", async () => {
    const { auditBindings } = await lib();
    expect(auditBindings([project("alpha")], {})).toEqual([
      { kind: "unlocatable", project: "alpha" },
    ]);
  });

  test("reports a path that no longer exists", async () => {
    const { auditBindings } = await lib();
    expect(auditBindings([project("alpha", "/gone/alpha")], {})).toEqual([
      { kind: "missing", project: "alpha", path: resolve("/gone/alpha") },
    ]);
  });

  // The transcend shape: one name reused for a second checkout. Binding by name
  // alone would silently repoint the first, so the collision must surface.
  test("reports two projects sharing one directory", async () => {
    const { auditBindings } = await lib();
    const shared = checkout("transcend");
    const issues = auditBindings(
      [project("transcend", shared), project("transcend-internal", shared)],
      {}
    );
    expect(issues).toEqual([
      { kind: "shared", path: shared, projects: ["transcend", "transcend-internal"] },
    ]);
  });

  test("a binding overrides the record, and is audited instead of it", async () => {
    const { auditBindings } = await lib();
    const real = checkout("alpha");
    expect(auditBindings([project("alpha", "/gone/alpha")], { alpha: real })).toEqual([]);
  });

  test("never writes anything", async () => {
    const { auditBindings } = await lib();
    const { bindingsFilePath } = await import("../src/hooks/lib/bindings");
    auditBindings([project("alpha", checkout("alpha"))], {});
    expect(require("node:fs").existsSync(bindingsFilePath(HOME))).toBe(false);
  });
});

describe("describeBindingIssue", () => {
  test("tells the user how to fix an unlocatable project", async () => {
    const { describeBindingIssue } = await lib();
    const msg = describeBindingIssue({ kind: "unlocatable", project: "alpha" });
    expect(msg).toContain("not checked out here");
    expect(msg).toContain("set-path alpha");
  });

  test("names both projects in a collision", async () => {
    const { describeBindingIssue } = await lib();
    const msg = describeBindingIssue({
      kind: "shared",
      path: "/w/t",
      projects: ["transcend", "transcend-internal"],
    });
    expect(msg).toContain("transcend and transcend-internal");
  });
});
