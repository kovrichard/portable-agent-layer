import type { AgentType } from "../core/agent";
import { withPalEnv } from "../core/pal-env";
import { getClaudeBinary } from "./inference-binaries";

export interface AgentLogin {
  checkedAt: string;
  loggedIn: boolean;
  authMethod: string | null;
  expiresAt: string | null;
  expiresAtEpoch: number | null;
}

interface CommandRun {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

export type CommandRunner = (argv: string[], timeoutMs: number) => CommandRun;

export type LoginRead =
  | { kind: "known"; login: AgentLogin }
  | { kind: "unknown" }
  | { kind: "failed"; reason: string };

const STATUS_TIMEOUT_MS = 2000;

export const systemRunner: CommandRunner = (argv, timeoutMs) => {
  const run = Bun.spawnSync(argv, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    windowsHide: true,
    env: withPalEnv(),
  });

  return {
    code: run.exitCode,
    stdout: run.stdout.toString(),
    timedOut: Boolean(run.exitedDueToTimeout),
  };
};

export function reportsLoginExpiry(agent: AgentType): boolean {
  return agent === "claude";
}

function epochSeconds(iso: string | null): number | null {
  const ms = iso === null ? Number.NaN : Date.parse(iso);

  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function parsedJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);

    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function claudeLoginFrom(stdout: string, now: Date): AgentLogin | null {
  const status = parsedJson(stdout);
  if (typeof status?.loggedIn !== "boolean") return null;
  const expiresAt =
    typeof status.loginExpiresAt === "string" ? status.loginExpiresAt : null;
  const expiresAtEpoch = epochSeconds(expiresAt);

  return {
    checkedAt: now.toISOString(),
    loggedIn: status.loggedIn,
    authMethod: typeof status.authMethod === "string" ? status.authMethod : null,
    expiresAt: expiresAtEpoch === null ? null : expiresAt,
    expiresAtEpoch,
  };
}

function readClaudeLogin(run: CommandRunner, now: Date): LoginRead {
  const bin = getClaudeBinary();
  if (!bin) return { kind: "failed", reason: "claude is not on PATH" };
  const result = run([bin, "auth", "status"], STATUS_TIMEOUT_MS);
  if (result.timedOut) return { kind: "failed", reason: "claude auth status timed out" };

  if (result.code !== 0) {
    return { kind: "failed", reason: `claude auth status exited with ${result.code}` };
  }

  const login = claudeLoginFrom(result.stdout, now);

  return login
    ? { kind: "known", login }
    : { kind: "failed", reason: "claude auth status did not print the expected JSON" };
}

export function readAgentLogin(
  agent: AgentType,
  run: CommandRunner,
  now: Date
): LoginRead {
  return reportsLoginExpiry(agent) ? readClaudeLogin(run, now) : { kind: "unknown" };
}
