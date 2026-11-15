import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findBinaryOnPath } from "../../src/core/which";
import type { AgentLogin, CommandRunner } from "../../src/hooks/lib/agent-login";

type CommandRun = ReturnType<CommandRunner>;

export const NOW = new Date("2026-11-15T09:52:00.000Z");
export const EXPIRES_AT = "2026-12-05T15:52:29.450Z";
export const EXPIRES_AT_EPOCH = 1796485949;

export function statusJson(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    loginExpiresAt: EXPIRES_AT,
    ...fields,
  });
}

export function cachedLogin(fields: Partial<AgentLogin> = {}): AgentLogin {
  return {
    checkedAt: NOW.toISOString(),
    loggedIn: true,
    authMethod: "claude.ai",
    expiresAt: EXPIRES_AT,
    expiresAtEpoch: EXPIRES_AT_EPOCH,
    ...fields,
  };
}

export interface RecordedRunner {
  run: CommandRunner;
  calls: { argv: string[]; timeoutMs: number }[];
}

export function fakeRunner(
  reply: Partial<CommandRun> | (() => CommandRun)
): RecordedRunner {
  const calls: RecordedRunner["calls"] = [];
  const run: CommandRunner = (argv, timeoutMs) => {
    calls.push({ argv, timeoutMs });

    return typeof reply === "function"
      ? reply()
      : { code: 0, stdout: "", timedOut: false, ...reply };
  };

  return { run, calls };
}

export function fakeClaudeOnPath(dir: string): string {
  const bin = resolve(dir, "bin");
  mkdirSync(bin, { recursive: true });

  for (const name of ["claude", "claude.cmd"]) {
    writeFileSync(resolve(bin, name), "");
    chmodSync(resolve(bin, name), 0o755);
  }

  process.env.PATH = bin;

  return findBinaryOnPath("claude") ?? "";
}
