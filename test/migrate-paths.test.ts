import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-migrate-paths-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

/** A record in the pre-bindings shape, with a body worth losing. */
function legacyRecord(name: string, path: string) {
  const dir = resolve(HOME, "memory", "projects", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: "${name}"\npath: "${path}"\nstatus: "active"\n` +
      `created: "2026-01-01"\nupdated: "2026-02-02"\n---\n\n` +
      `## Goal\nShip the thing.\n\n## Criteria\n- [ ] ISC-1: works\n`
  );
  return resolve(dir, "ISA.md");
}

function checkout(name: string): string {
  const dir = resolve(HOME, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function migration() {
  const { checkPendingMigrations } = await import("../src/cli/migrate");
  return checkPendingMigrations().find((m) => m.id === "v4-paths-to-bindings");
}

describe("v4 paths-to-bindings", () => {
  test("is pending while a record still stores a path", async () => {
    legacyRecord("alpha", checkout("alpha"));
    expect((await migration())?.detail).toContain("1 record");
  });

  test("is not pending on a home whose records carry no path", async () => {
    mkdirSync(resolve(HOME, "memory", "projects"), { recursive: true });
    expect(await migration()).toBeUndefined();
  });

  test("moves the path into a binding and out of the record", async () => {
    const dir = checkout("alpha");
    const file = legacyRecord("alpha", dir);
    const { runMigrate } = await import("../src/cli/migrate");
    const { bindingFor } = await import("../src/hooks/lib/bindings");

    runMigrate([]);

    expect(readFileSync(file, "utf-8")).not.toContain("path:");
    expect(bindingFor("alpha", HOME)).toBe(dir);
  });

  // Content, not bytes: the writer normalizes spacing after a heading, so a
  // hand-written record comes back canonically formatted. Every section and its
  // text must survive, and `updated` must not move — the staleness ordering in
  // the project list is built on it.
  test("preserves every section, its text, and the updated timestamp", async () => {
    const file = legacyRecord("alpha", checkout("alpha"));
    const { runMigrate } = await import("../src/cli/migrate");

    runMigrate([]);
    const after = readFileSync(file, "utf-8");

    expect(after).toContain("## Goal");
    expect(after).toContain("Ship the thing.");
    expect(after).toContain("## Criteria");
    expect(after).toContain("- [ ] ISC-1: works");
    expect(after).toContain('updated: "2026-02-02"');
  });

  test("a record already in canonical form comes back byte-identical apart from the path", async () => {
    const dir = checkout("beta");
    const { writeProject, readProject } = await import("../src/hooks/lib/projects");
    writeProject({
      name: "beta",
      path: dir,
      status: "active",
      created: "2026-01-01",
      updated: "2026-02-02",
      goal: "Ship it.",
    });
    const file = resolve(HOME, "memory", "projects", "beta", "ISA.md");
    const before = readFileSync(file, "utf-8");

    const p = readProject("beta");
    if (p) writeProject(p);

    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("a dry run changes nothing on disk", async () => {
    const file = legacyRecord("alpha", checkout("alpha"));
    const before = readFileSync(file, "utf-8");
    const { runMigrate } = await import("../src/cli/migrate");
    const { bindingsFilePath } = await import("../src/hooks/lib/bindings");

    runMigrate(["--dry-run"]);

    expect(readFileSync(file, "utf-8")).toBe(before);
    expect(existsSync(bindingsFilePath(HOME))).toBe(false);
  });

  test("stops being pending once it has run", async () => {
    legacyRecord("alpha", checkout("alpha"));
    const { runMigrate } = await import("../src/cli/migrate");
    runMigrate([]);
    expect(await migration()).toBeUndefined();
  });
});
