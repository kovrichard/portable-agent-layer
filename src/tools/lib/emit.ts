/**
 * Output convention for agent-invoked CLI tools: quiet on success, full on
 * failure. The agent captures tool output over a pipe (non-TTY), where success
 * confirmations are pure noise that costs context tokens; a human at a TTY wants
 * them. Gate on the TTY signal, with PAL_VERBOSE / PAL_QUIET as explicit overrides.
 *
 *   data()     requested payload — ALWAYS emitted (list output, reports, results)
 *   receipt()  proof a write landed — ALWAYS emitted (see below)
 *   ok()       success confirmation / progress — only at a TTY or under PAL_VERBOSE
 *
 * Errors stay on console.error (stderr) + a non-zero exit — always surfaced,
 * independent of this gate.
 *
 * Why receipt() is not gated: a state-changing call's confirmation is its
 * payload, not progress chatter. Without it a caller cannot tell what landed or
 * where, and re-reads the file to find out — which costs far more context than
 * the one line the gate saved. The receipt reports what was actually written,
 * so a writer that deduplicates or trims must report the real count rather than
 * what it was handed. `no-silent-write` in klint.rules.ts enforces that every
 * tool writing to disk emits one.
 */

import { relative } from "node:path";
import { palHome } from "../../hooks/lib/paths";

function isVerbose(): boolean {
  if (process.env.PAL_QUIET === "1") return false;
  if (process.env.PAL_VERBOSE === "1") return true;
  return Boolean(process.stdout.isTTY);
}

function line(stream: { write: (s: string) => void }, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

/**
 * Paths are reported relative to PAL_HOME so a receipt reads the same on every
 * machine, and never discloses an absolute home path. A file outside PAL_HOME
 * keeps its own path — a "../.." chain would name nothing useful.
 */
function homeRelative(file: string): string {
  const rel = relative(palHome(), file).replaceAll("\\", "/");
  return rel && !rel.startsWith("..") ? rel : file.replaceAll("\\", "/");
}

export const emit = {
  data(text: string): void {
    line(process.stdout, text);
  },
  ok(text: string): void {
    if (isVerbose()) line(process.stdout, text);
  },
  /** Proof that a write landed: the file it went to, plus what the operation produced. */
  receipt(file: string, extra: Record<string, unknown> = {}): void {
    line(
      process.stdout,
      JSON.stringify({ ok: true, wrote: homeRelative(file), ...extra })
    );
  },
};
