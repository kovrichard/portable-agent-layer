import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { removeOnceReleased } from "./lib/remove-once-released";
import { runSync } from "./lib/run";
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
      const result = runSync(["bun", script], {
        cwd: sandbox,
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
      const pack = runSync(["bun", "pm", "pack", "--destination", sandbox], {
        cwd: REPO,
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
      const list = runSync(["tar", "-tzf", basename(tarballPath)], {
        cwd: sandbox,
      });
      expect(list.status).toBe(0);
      expect(list.stdout).toContain("package/.husky/install.mjs");
    } finally {
      removeOnceReleased(sandbox);
    }
  }, 60000);
});
