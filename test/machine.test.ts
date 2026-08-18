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
  HOME = mkdtempSync(resolve(tmpdir(), "pal-machine-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/machine");
}

describe("loadMachine", () => {
  test("creates machine.json on first call with a uuid", async () => {
    const { loadMachine, machineFilePath } = await lib();
    const m = loadMachine(HOME);
    expect(m.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(existsSync(machineFilePath(HOME))).toBe(true);
  });

  test("returns the same id on every subsequent call", async () => {
    const { loadMachine } = await lib();
    const first = loadMachine(HOME);
    const second = loadMachine(HOME);
    const third = loadMachine(HOME);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
  });

  test("records os and a creation timestamp", async () => {
    const { loadMachine } = await lib();
    const m = loadMachine(HOME);
    expect(m.os.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(m.createdAt))).toBe(false);
  });

  test("regenerates when the file is corrupt rather than throwing", async () => {
    const { loadMachine, machineFilePath } = await lib();
    writeFileSync(machineFilePath(HOME), "not json at all");
    const m = loadMachine(HOME);
    expect(m.id.length).toBeGreaterThan(0);
  });

  test("regenerates when the file is valid json but missing an id", async () => {
    const { loadMachine, machineFilePath } = await lib();
    writeFileSync(machineFilePath(HOME), JSON.stringify({ label: "orphan" }));
    const m = loadMachine(HOME);
    expect(m.id.length).toBeGreaterThan(0);
    expect(m.label).not.toBe("orphan");
  });

  test("REPAIRS rather than regenerates when the id survives but fields are missing", async () => {
    const { loadMachine, machineFilePath, defaultLabel } = await lib();
    writeFileSync(machineFilePath(HOME), JSON.stringify({ id: "kept-id" }));
    const m = loadMachine(HOME);
    expect(m.id).toBe("kept-id");
    expect(m.label).toBe(defaultLabel("kept-id"));
    expect(m.os.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(m.createdAt))).toBe(false);
  });

  test("keeps a repaired id stable across reloads", async () => {
    const { loadMachine, machineFilePath } = await lib();
    writeFileSync(machineFilePath(HOME), JSON.stringify({ id: "kept-id" }));
    expect(loadMachine(HOME).id).toBe("kept-id");
    expect(loadMachine(HOME).id).toBe("kept-id");
  });
});

describe("defaultLabel", () => {
  test("is derived from the id, never from the hostname", async () => {
    const { defaultLabel } = await lib();
    const label = defaultLabel("9f2c8e14-1111-2222-3333-444455556666");
    expect(label).toBe("machine-9f2c");
    expect(label).not.toContain(require("node:os").hostname());
  });

  test("shortId takes four hex chars and ignores dashes", async () => {
    const { shortId } = await lib();
    expect(shortId("9f2c8e14-1111-2222-3333-444455556666")).toBe("9f2c");
    expect(shortId("ab-cd-ef-01")).toBe("abcd");
  });
});

describe("setLabel", () => {
  test("changes the label while keeping the id", async () => {
    const { loadMachine, setLabel } = await lib();
    const before = loadMachine(HOME);
    const after = setLabel("workstation", HOME);
    expect(after.label).toBe("workstation");
    expect(after.id).toBe(before.id);
  });

  test("persists across reloads", async () => {
    const { loadMachine, setLabel } = await lib();
    loadMachine(HOME);
    setLabel("workstation", HOME);
    expect(loadMachine(HOME).label).toBe("workstation");
  });

  test("ignores an empty label instead of clearing the name", async () => {
    const { loadMachine, setLabel } = await lib();
    const before = setLabel("workstation", HOME);
    const after = setLabel("   ", HOME);
    expect(after.label).toBe(before.label);
    expect(loadMachine(HOME).label).toBe("workstation");
  });
});

describe("registry", () => {
  test("ensureRegistered writes an entry under memory/machines", async () => {
    const { ensureRegistered } = await lib();
    const m = ensureRegistered(HOME);
    expect(existsSync(resolve(HOME, "memory", "machines", `${m.id}.md`))).toBe(true);
  });

  test("readRegistry returns every written machine", async () => {
    const { writeRegistryEntry, readRegistry } = await lib();
    writeRegistryEntry({ id: "id-a", label: "alpha", os: "linux" });
    writeRegistryEntry({ id: "id-b", label: "beta", os: "darwin" });
    const reg = readRegistry();
    expect(reg.map((e) => e.label).sort()).toEqual(["alpha", "beta"]);
  });

  test("re-registering updates the label and does not duplicate the entry", async () => {
    const { writeRegistryEntry, readRegistry } = await lib();
    writeRegistryEntry({ id: "id-a", label: "alpha", os: "linux" });
    writeRegistryEntry({ id: "id-a", label: "renamed", os: "linux" });
    const reg = readRegistry();
    expect(reg.length).toBe(1);
    expect(reg[0].label).toBe("renamed");
  });

  test("preserves the entry body across a label change", async () => {
    const { writeRegistryEntry } = await lib();
    writeRegistryEntry({ id: "id-a", label: "alpha", os: "linux" }, "roots: /home/x");
    writeRegistryEntry({ id: "id-a", label: "renamed", os: "linux" });
    const raw = readFileSync(resolve(HOME, "memory", "machines", "id-a.md"), "utf-8");
    expect(raw).toContain("roots: /home/x");
    expect(raw).toContain("renamed");
  });

  test("skips a malformed entry without hiding the rest", async () => {
    const { writeRegistryEntry, readRegistry } = await lib();
    writeRegistryEntry({ id: "id-a", label: "alpha", os: "linux" });
    mkdirSync(resolve(HOME, "memory", "machines"), { recursive: true });
    writeFileSync(
      resolve(HOME, "memory", "machines", "broken.md"),
      "no frontmatter here"
    );
    const reg = readRegistry();
    expect(reg.length).toBe(1);
    expect(reg[0].label).toBe("alpha");
  });
});

describe("displayName", () => {
  test("resolves a known id to its label", async () => {
    const { displayName } = await lib();
    const reg = [{ id: "id-a", label: "macbook", os: "darwin" }];
    expect(displayName("id-a", reg)).toBe("macbook");
  });

  test("does NOT suffix when the label is unique", async () => {
    const { displayName } = await lib();
    const reg = [
      { id: "id-a", label: "macbook", os: "darwin" },
      { id: "id-b", label: "desktop", os: "linux" },
    ];
    expect(displayName("id-a", reg)).toBe("macbook");
  });

  test("suffixes with the short id when two machines share a label", async () => {
    const { displayName } = await lib();
    const reg = [
      { id: "aaaa1111-0000-0000-0000-000000000000", label: "macbook", os: "darwin" },
      { id: "bbbb2222-0000-0000-0000-000000000000", label: "macbook", os: "darwin" },
    ];
    expect(displayName("aaaa1111-0000-0000-0000-000000000000", reg)).toBe("macbook·aaaa");
    expect(displayName("bbbb2222-0000-0000-0000-000000000000", reg)).toBe("macbook·bbbb");
  });

  test("falls back to the short id when the machine is unknown", async () => {
    const { displayName } = await lib();
    expect(displayName("ffff9999-0000-0000-0000-000000000000", [])).toBe("ffff");
  });
});

describe("machine.json never leaves the machine", () => {
  test("is absent from collectExportFiles even when it exists", async () => {
    const { loadMachine } = await lib();
    loadMachine(HOME);
    mkdirSync(resolve(HOME, "telos"), { recursive: true });
    writeFileSync(resolve(HOME, "telos", "GOALS.md"), "# Goals\n");

    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith("machine.json"))).toBe(false);
  });

  test("is denied at the import boundary", async () => {
    const { isNeverImport } = await import("../src/hooks/lib/import-merge");
    expect(isNeverImport("machine.json")).toBe(true);
    expect(isNeverImport("export-manifest.json")).toBe(true);
  });

  test("registry entries DO travel, so labels can cross", async () => {
    const { ensureRegistered } = await lib();
    const m = ensureRegistered(HOME);
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    expect(collectExportFiles()).toContain(`memory/machines/${m.id}.md`);
  });
});

describe("export manifest", () => {
  test("names the producing machine and the file count", async () => {
    const { buildManifest } = await import("../src/hooks/lib/export");
    const mf = buildManifest({ id: "id-a", label: "macbook", os: "darwin" }, 7);
    expect(mf.machineId).toBe("id-a");
    expect(mf.label).toBe("macbook");
    expect(mf.fileCount).toBe(7);
    expect(Number.isNaN(Date.parse(mf.exportedAt))).toBe(false);
  });

  test("readManifest round-trips what buildManifest produced", async () => {
    const { buildManifest, MANIFEST_NAME } = await import("../src/hooks/lib/export");
    const { readManifest } = await import("../src/hooks/lib/import-merge");
    const mf = buildManifest({ id: "id-a", label: "macbook", os: "darwin" }, 7);
    const got = readManifest([
      { path: MANIFEST_NAME, data: () => Buffer.from(JSON.stringify(mf)) },
    ]);
    expect(got?.machineId).toBe("id-a");
    expect(got?.label).toBe("macbook");
  });

  test("returns null for an archive with no manifest", async () => {
    const { readManifest } = await import("../src/hooks/lib/import-merge");
    expect(
      readManifest([{ path: "telos/GOALS.md", data: () => Buffer.from("x") }])
    ).toBeNull();
  });

  test("returns null for a corrupt or id-less manifest", async () => {
    const { MANIFEST_NAME } = await import("../src/hooks/lib/export");
    const { readManifest } = await import("../src/hooks/lib/import-merge");
    expect(
      readManifest([{ path: MANIFEST_NAME, data: () => Buffer.from("{{{") }])
    ).toBeNull();
    expect(
      readManifest([{ path: MANIFEST_NAME, data: () => Buffer.from('{"label":"x"}') }])
    ).toBeNull();
  });
});
