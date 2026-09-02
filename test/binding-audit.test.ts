import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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

describe("proposeBinding", () => {
  function repoAt(name: string, origin?: string): string {
    const dir = checkout(name);
    spawnSync("git", ["init", "-q", dir]);
    if (origin) spawnSync("git", ["-C", dir, "remote", "add", "origin", origin]);
    return dir;
  }

  test("is strong when the repository here is the project's recorded remote", async () => {
    const { proposeBinding } = await lib();
    const dir = repoAt("anything", "git@github.com:a/b.git");
    const p = { ...project("some-other-name"), remote: "github.com/a/b" };

    const proposal = proposeBinding(p, dir);
    expect(proposal?.confidence).toBe("strong");
    expect(proposal?.command).toContain("set-path some-other-name");
  });

  // The transcend shape: a name can belong to more than one checkout, so a name
  // match must never be presented as certain.
  test("is only weak when nothing but the directory name agrees", async () => {
    const { proposeBinding } = await lib();
    const proposal = proposeBinding(project("transcend"), checkout("transcend"));
    expect(proposal?.confidence).toBe("weak");
    expect(proposal?.reason).toContain("more than one checkout");
  });

  test("stays silent when neither remote nor name matches", async () => {
    const { proposeBinding } = await lib();
    expect(proposeBinding(project("alpha"), checkout("something-else"))).toBeNull();
  });

  test("a differing remote does not get promoted by a matching name", async () => {
    const { proposeBinding } = await lib();
    const dir = repoAt("transcend", "git@github.com:someone/other.git");
    const p = { ...project("transcend"), remote: "github.com/rico/transcend" };
    expect(proposeBinding(p, dir)?.confidence).toBe("weak");
  });

  test("only ever suggests a command, never performs the binding", async () => {
    const { proposeBinding } = await lib();
    const { readBindings } = await import("../src/hooks/lib/bindings");
    proposeBinding(project("transcend"), checkout("transcend"));
    expect(readBindings(HOME)).toEqual({});
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
