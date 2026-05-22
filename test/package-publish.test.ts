import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

describe("package publish surface", () => {
  test(".husky/install.mjs ships so the prepare script can run in package mode", () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf-8"));
    expect(pkg.files).toContain(".husky/install.mjs");
    expect(pkg.scripts.prepare).toBe("bun .husky/install.mjs");
  });

  test("prepare script exits 0 when .git is absent (package mode)", () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), "pal-prepare-"));
    try {
      const script = resolve(REPO, ".husky/install.mjs");
      const result = spawnSync("bun", [script], {
        cwd: sandbox,
        encoding: "utf-8",
        env: { ...process.env, CI: "", NODE_ENV: "" },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("packed tarball contains .husky/install.mjs", () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), "pal-pack-"));
    try {
      const pack = spawnSync("bun", ["pm", "pack", "--destination", sandbox], {
        cwd: REPO,
        encoding: "utf-8",
        timeout: 60000,
      });
      expect(pack.status).toBe(0);

      const tarball = pack.stdout
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.endsWith(".tgz"));
      expect(tarball).toBeTruthy();
      const tarballPath = resolve(sandbox, tarball as string);
      expect(existsSync(tarballPath)).toBe(true);

      const list = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf-8" });
      expect(list.status).toBe(0);
      expect(list.stdout).toContain("package/.husky/install.mjs");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 60000);
});
