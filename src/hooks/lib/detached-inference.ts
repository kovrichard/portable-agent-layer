/**
 * Shared spawn helper for detached background inference calls.
 *
 * PAL hooks that need to run an inference but cannot block the parent hook
 * process (UserPromptSubmit, Stop) spawn a detached bun subprocess that
 * re-enters the same handler script with a mode flag. This helper centralizes
 * the spawn boilerplate: detach + unref + CLAUDECODE-scrub + debug/error logs.
 *
 * Usage:
 *   spawnDetachedInference(
 *     import.meta.filename,                  // re-invokes this script
 *     ["--sentiment", sessionId, msgB64],    // mode flag + payload args
 *     "rating"                                // scope for logs
 *   );
 *
 * Payloads over a few KB should be passed via file path (write to tmp,
 * pass path) rather than argv to avoid ARG_MAX limits (~256KB on macOS).
 */

import { spawn } from "node:child_process";
import { logDebug, logError } from "./log";

export function spawnDetachedInference(
  scriptPath: string,
  args: string[],
  scope: string
): void {
  try {
    const child = spawn("bun", [scriptPath, ...args], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CLAUDECODE: undefined },
      windowsHide: true,
    });
    child.unref();
    logDebug(scope, `detached inference spawned: ${args[0] ?? "no-mode"}`);
  } catch (err) {
    logError(scope, err);
  }
}
