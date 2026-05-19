/**
 * Cross-platform fake-CLI helper for dispatcher tests.
 *
 * Writes a TypeScript snippet to disk and wraps it in a thin platform shim
 * so that the host can invoke it as a bare binary name once `dir` is added
 * to PATH:
 *
 *   POSIX  → `<dir>/<name>`       (chmod +x, `#!/bin/sh` exec wrapper)
 *   Windows → `<dir>/<name>.cmd`   (resolved via PATHEXT)
 *
 * Both wrappers delegate to `bun run <dir>/<name>.ts "$@"` so the same
 * TypeScript logic runs on every platform without porting shell tricks.
 *
 * The TS snippet has the full Bun runtime available — `Bun.stdin.stream()`,
 * `Bun.argv`, `process.env`, `console.log`, etc.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";

/** Prepend a directory to process.env.PATH using the platform delimiter. */
export function prependPath(dir: string): void {
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

export function writeFakeBin(dir: string, name: string, tsLogic: string): void {
  const tsFile = resolve(dir, `${name}.ts`);
  writeFileSync(tsFile, tsLogic, "utf-8");

  if (process.platform === "win32") {
    // Resolve bun.exe to an absolute path so the wrapper doesn't depend on
    // cmd.exe's PATH lookup inside the spawned shell. `setlocal` isolates env
    // mutations; `exit /b` propagates bun's exit code back to Bun.spawn.
    const bunExe = Bun.which("bun") ?? "bun.exe";
    const cmd = resolve(dir, `${name}.cmd`);
    const body = [
      "@echo off",
      "setlocal",
      `"${bunExe}" run "${tsFile}" %*`,
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n");
    writeFileSync(cmd, body, "utf-8");
    return;
  }
  const sh = resolve(dir, name);
  writeFileSync(sh, `#!/bin/sh\nexec bun run "${tsFile}" "$@"\n`, "utf-8");
  chmodSync(sh, 0o755);
}
