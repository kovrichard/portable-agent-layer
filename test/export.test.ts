import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-export");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });

  // Scaffold a fake PAL home
  mkdirSync(resolve(TEST_HOME, "telos"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "signals"), { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory", "downloads", "2026"), {
    recursive: true,
  });

  // Write some test files
  writeFileSync(resolve(TEST_HOME, "telos", "MISSION.md"), "# Mission\n");
  writeFileSync(resolve(TEST_HOME, "telos", "GOALS.md"), "# Goals\n");
  writeFileSync(resolve(TEST_HOME, "memory", "state", "setup.json"), "{}");
  writeFileSync(
    resolve(TEST_HOME, "memory", "signals", "ratings.jsonl"),
    '{"rating":5}\n'
  );
  writeFileSync(resolve(TEST_HOME, "memory", "downloads", "2026", "file.pdf"), "pdf");

  process.env.PAL_HOME = TEST_HOME;
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

describe("collectExportFiles", () => {
  test("collects telos and memory files", async () => {
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();

    expect(files).toContain("telos/MISSION.md");
    expect(files).toContain("telos/GOALS.md");
    expect(files).toContain("memory/state/setup.json");
    expect(files).toContain("memory/signals/ratings.jsonl");
  });

  test("skips memory/downloads", async () => {
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();
    const downloads = files.filter((f) => f.startsWith("memory/downloads"));
    expect(downloads).toHaveLength(0);
  });
});

describe("exportZip", () => {
  test("creates a valid zip file", async () => {
    const { exportZip } = await import("../src/hooks/lib/export");
    const zipPath = resolve(TEST_HOME, "test-export.zip");

    const count = exportZip(zipPath);
    expect(count).toBeGreaterThan(0);
    expect(existsSync(zipPath)).toBe(true);
  });

  test("zip contains expected files", async () => {
    const AdmZip = (await import("adm-zip")).default;
    const zipPath = resolve(TEST_HOME, "test-export.zip");
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map((e) => e.entryName);

    expect(entries).toContain("telos/MISSION.md");
    expect(entries).toContain("telos/GOALS.md");
  });
});

describe("timestamp", () => {
  test("returns 14-char timestamp string", async () => {
    const { timestamp } = await import("../src/hooks/lib/export");
    const ts = timestamp();
    expect(ts).toHaveLength(14);
    expect(/^\d{14}$/.test(ts)).toBe(true);
  });
});
