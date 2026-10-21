import { SPAWN_GUARD_ENV } from "../../src/hooks/lib/spawn-guard";

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_HOME",
  "PAL_INFERENCE_DISABLED",
  "PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  SPAWN_GUARD_ENV.SENTINEL,
  SPAWN_GUARD_ENV.DEPTH,
] as const;

export function savedEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of PRESERVED) saved[k] = process.env[k];
  return saved;
}

export function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of PRESERVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
