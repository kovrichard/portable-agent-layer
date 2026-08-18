import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { linkDir } from "./helpers/links";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

function palCli(args: string[], opts: { input?: string } = {}) {
  return spawnSync("bun", ["run", CLI, "cli", ...args], {
    env: { ...process.env, PAL_HOME: TEST_HOME },
    encoding: "utf-8",
    input: opts.input,
    timeout: 15000,
  });
}

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

  // A user-authored personal skill (real directory) — should be exported.
  mkdirSync(resolve(TEST_HOME, "skills", "my-skill"), { recursive: true });
  writeFileSync(resolve(TEST_HOME, "skills", "my-skill", "SKILL.md"), "# My Skill\n");

  // A shipped skill, present only as a symlink back to the repo — must NOT be
  // exported. The symlink target has a real file that would be picked up if
  // walkDir ever followed symlinks.
  mkdirSync(resolve(TEST_HOME, "shipped-source"), { recursive: true });
  writeFileSync(resolve(TEST_HOME, "shipped-source", "SKILL.md"), "# Shipped\n");
  linkDir(
    resolve(TEST_HOME, "shipped-source"),
    resolve(TEST_HOME, "skills", "shipped-skill")
  );

  // A user-authored personal subagent (real file) — should be exported.
  mkdirSync(resolve(TEST_HOME, "agents"), { recursive: true });
  writeFileSync(
    resolve(TEST_HOME, "agents", "my-helper.md"),
    "---\nname: my-helper\n---\n"
  );

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

  test("collects user-authored personal skills and subagents", async () => {
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();
    expect(files).toContain("skills/my-skill/SKILL.md");
    expect(files).toContain("agents/my-helper.md");
  });

  test("excludes shipped-skill symlinks — only real user files travel", async () => {
    const { collectExportFiles } = await import("../src/hooks/lib/export");
    const files = collectExportFiles();
    const shipped = files.filter((f) => f.startsWith("skills/shipped-skill"));
    expect(shipped).toHaveLength(0);
  });
});

describe("exportZip", () => {
  const zipPath = resolve(TEST_HOME, "test-export.zip");

  async function writeZip() {
    const { exportZip } = await import("../src/hooks/lib/export");
    return exportZip(zipPath);
  }

  test("creates a valid zip file", async () => {
    const count = await writeZip();
    expect(count).toBeGreaterThan(0);
    expect(existsSync(zipPath)).toBe(true);
  });

  test("zip contains expected files", async () => {
    await writeZip();
    const AdmZip = (await import("adm-zip")).default;
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

describe("cli export — folder arg", () => {
  test("auto-names zip inside given directory", () => {
    const outDir = mkdtempSync(resolve(tmpdir(), "pal-export-dir-"));
    try {
      const result = palCli(["export", outDir]);
      expect(result.status).toBe(0);
      const zips = readdirSync(outDir).filter(
        (f) => f.startsWith("pal-export-") && f.endsWith(".zip")
      );
      expect(zips).toHaveLength(1);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("dry-run with folder arg lists files without writing", () => {
    const outDir = mkdtempSync(resolve(tmpdir(), "pal-export-dry-"));
    try {
      const result = palCli(["export", outDir, "--dry-run"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Would export");
      // No zip written in dry-run
      const zips = readdirSync(outDir).filter((f) => f.endsWith(".zip"));
      expect(zips).toHaveLength(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("cli import — folder arg", () => {
  test("finds latest zip in given directory and dry-runs import", () => {
    const workDir = mkdtempSync(resolve(tmpdir(), "pal-import-dir-"));
    try {
      // Export to workDir first so there is a zip to find
      const exportResult = palCli(["export", workDir]);
      expect(exportResult.status).toBe(0);

      // Import from workDir (folder arg) — pipe "y" to the confirmation prompt.
      // Dry-run names the mode it would take, since merge and overwrite differ
      // destructively.
      const importResult = palCli(["import", workDir, "--dry-run"], { input: "y\n" });
      expect(importResult.status).toBe(0);
      expect(importResult.stdout).toContain("Would merge");

      const overwriteDry = palCli(["import", workDir, "--dry-run", "--overwrite"], {
        input: "y\n",
      });
      expect(overwriteDry.status).toBe(0);
      expect(overwriteDry.stdout).toContain("Would overwrite with");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("exits non-zero when folder has no zip files", () => {
    const emptyDir = mkdtempSync(resolve(tmpdir(), "pal-import-empty-"));
    try {
      const result = palCli(["import", emptyDir], { input: "y\n" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("No export or backup files found");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("round-trips a personal skill and subagent into a fresh home", () => {
    const workDir = mkdtempSync(resolve(tmpdir(), "pal-roundtrip-"));
    const freshHome = mkdtempSync(resolve(tmpdir(), "pal-fresh-home-"));
    try {
      // Export the seeded TEST_HOME (has skills/my-skill + agents/my-helper).
      const exportResult = palCli(["export", workDir]);
      expect(exportResult.status).toBe(0);

      // Import into an empty home — the personal files must materialize.
      const importResult = spawnSync("bun", ["run", CLI, "cli", "import", workDir], {
        env: { ...process.env, PAL_HOME: freshHome },
        encoding: "utf-8",
        input: "y\n",
        timeout: 15000,
      });
      expect(importResult.status).toBe(0);
      expect(existsSync(resolve(freshHome, "skills", "my-skill", "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(freshHome, "agents", "my-helper.md"))).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(freshHome, { recursive: true, force: true });
    }
  });
});
