import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const REPO = resolve(import.meta.dir, "..");

describe("package publish surface", () => {
  test(".husky/install.mjs ships so the prepare script can run in package mode", () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf-8"));
    expect(pkg.files).toContain(".husky/install.mjs");
    expect(pkg.scripts.prepare).toBe("bun .husky/install.mjs");
  });

  test("prepare script exits 0 when .git is absent (package mode)", () => {
    const sandbox = freshTestDir(import.meta.file);
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
      removeOnceReleased(sandbox);
    }
  });

  test("packed tarball contains .husky/install.mjs", () => {
    const sandbox = freshTestDir(import.meta.file);
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

      // Listed by bare name from inside the sandbox: GNU tar reads the colon in
      // a Windows path as a host:path remote spec and tries to open a connection.
      const list = spawnSync("tar", ["-tzf", basename(tarballPath)], {
        cwd: sandbox,
        encoding: "utf-8",
      });
      expect(list.status).toBe(0);
      expect(list.stdout).toContain("package/.husky/install.mjs");
    } finally {
      removeOnceReleased(sandbox);
    }
  }, 60000);
});
