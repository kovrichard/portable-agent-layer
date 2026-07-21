/**
 * Output convention for agent-invoked CLI tools: quiet on success, full on
 * failure. The agent captures tool output over a pipe (non-TTY), where success
 * confirmations are pure noise that costs context tokens; a human at a TTY wants
 * them. Gate on the TTY signal, with PAL_VERBOSE / PAL_QUIET as explicit overrides.
 *
 *   data()  requested payload — ALWAYS emitted (list output, reports, results)
 *   ok()    success confirmation / progress — only at a TTY or under PAL_VERBOSE
 *
 * Errors stay on console.error (stderr) + a non-zero exit — always surfaced,
 * independent of this gate.
 */

function isVerbose(): boolean {
  if (process.env.PAL_QUIET === "1") return false;
  if (process.env.PAL_VERBOSE === "1") return true;
  return Boolean(process.stdout.isTTY);
}

function line(stream: { write: (s: string) => void }, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

export const emit = {
  data(text: string): void {
    line(process.stdout, text);
  },
  ok(text: string): void {
    if (isVerbose()) line(process.stdout, text);
  },
};
