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

/** A fake claude's logic that answers `replyExpr` the way `--output-format json` does. */
export function claudeReplying(replyExpr: string, usage: object = {}): string {
  return `const reply = ${replyExpr};\nconsole.log(JSON.stringify({ type: "result", is_error: false, result: String(reply), usage: ${JSON.stringify(usage)} }));\n`;
}

/** A fake codex's logic that answers `replyExpr` the way `codex exec --json` does. */
export function codexReplying(replyExpr: string, usage: object = {}): string {
  return [
    `const reply = ${replyExpr};`,
    `console.log(JSON.stringify({ type: "thread.started" }));`,
    `console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: String(reply) } }));`,
    `console.log(JSON.stringify({ type: "turn.completed", usage: ${JSON.stringify(usage)} }));`,
    "",
  ].join("\n");
}

/** A fake copilot's logic that answers `replyExpr` the way `--output-format json` does. */
const COPILOT_RUN_ID = "run-1";

export function copilotReplying(
  replyExpr: string,
  modelUsage?: object,
  runUsage?: object
): string {
  const checkpoint = modelUsage
    ? `console.log(JSON.stringify({ type: "session.usage_checkpoint", data: { promptCacheBreakState: [{ models: { m: ${JSON.stringify(modelUsage)} } }] } }));`
    : "";
  const shutdown = runUsage
    ? `await Bun.write(process.env.COPILOT_HOME + "/session-state/${COPILOT_RUN_ID}/events.jsonl", JSON.stringify({ type: "session.shutdown", data: { modelMetrics: { m: { usage: ${JSON.stringify(runUsage)} } } } }) + "\\n");`
    : "";
  return [
    `const reply = ${replyExpr};`,
    `console.log(JSON.stringify({ type: "assistant.message", data: { content: String(reply), phase: "final_answer" } }));`,
    checkpoint,
    shutdown,
    `console.log(JSON.stringify({ type: "result", sessionId: "${COPILOT_RUN_ID}", exitCode: 0 }));`,
    "",
  ].join("\n");
}

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
