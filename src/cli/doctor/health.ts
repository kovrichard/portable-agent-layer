import { resolve } from "node:path";
import { type HookErrorGroup, recentHookErrors } from "../../core/log";
import { palEnvPath } from "../../core/pal-env";
import { palHome } from "../../core/paths";
import { cachedStatus, type UpdateCache } from "../../hooks/handlers/update-check";
import type { AgentLogin } from "../../inference/agent-login";
import { loggedClaudeAuthMode } from "../../inference/inference-agents";
import { readLoginCache } from "../../inference/login-cache";
import { CLAUDE_LOGIN_REJECTED } from "../../inference/login-rejected";
import { checkPendingMigrations } from "../migrate";
import { type Finding, failing, passed, warning } from "./finding";

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
}

interface ErrorContext {
  now: number;
}

const MINUTE_MS = 60_000;
const LOG_IN_AGAIN = {
  say: "Log the Claude CLI in again",
  command: "claude auth login",
  external: true,
};

function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / MINUTE_MS));

  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function claudeLoginExpiredFinding(
  group: HookErrorGroup,
  context: ErrorContext
): Finding {
  const title = `Background calls to Claude could not log in — ${group.count} failed in the last 24h, last ${ago(group.lastAt, context.now)}: ${group.last}`;

  if (loggedClaudeAuthMode(group.lastMessage ?? "") === "token")
    return failing(`hook-errors.${group.source}`, title, {
      say: `CLAUDE_CODE_OAUTH_TOKEN was rejected — it expired or is invalid. Create a new one and replace it in ${palEnvPath()}`,
      command: "claude setup-token",
      external: true,
    });

  return failing(`hook-errors.${group.source}`, title, LOG_IN_AGAIN);
}

export function hookErrorFindings(
  groups: HookErrorGroup[],
  context: ErrorContext = { now: Date.now() }
): Finding[] {
  if (groups.length === 0)
    return [passed("hook-errors", "No hook errors in the last 24h")];
  const log = resolve(palHome(), "debug", "debug.log");

  return groups.map((group) => {
    if (CLAUDE_LOGIN_REJECTED.test(group.last))
      return claudeLoginExpiredFinding(group, context);
    const times = group.count === 1 ? "once" : `${group.count} times`;

    return warning(
      `hook-errors.${group.source}`,
      `${group.source} failed ${times} in the last 24h, last ${ago(group.lastAt, context.now)}: ${group.last}`,
      { say: `Full trace in ${log}` }
    );
  });
}

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;
const LOGIN_WARN_S = 7 * DAY_S;

function timeLeft(seconds: number): string {
  return seconds < DAY_S
    ? `${Math.floor(seconds / HOUR_S)}h`
    : `${Math.floor(seconds / DAY_S)}d`;
}

export function loginExpiryFindings(
  login: AgentLogin | null,
  now: number = Date.now()
): Finding[] {
  if (typeof login?.expiresAtEpoch !== "number") return [];
  const left = login.expiresAtEpoch - Math.floor(now / 1000);
  if (left <= 0)
    return [failing("claude-login.expiry", "Claude login expired", LOG_IN_AGAIN)];

  if (left > LOGIN_WARN_S) return [];

  return [
    warning(
      "claude-login.expiry",
      `Claude login expires in ${timeLeft(left)}`,
      LOG_IN_AGAIN
    ),
  ];
}

export function migrationFindings(pending: PendingMigration[]): Finding[] {
  if (pending.length === 0) return [passed("migrations", "No pending migrations")];

  return pending.map((migration) => {
    const detail = migration.detail ? ` (${migration.detail})` : "";

    return warning(
      `migration.${migration.id}`,
      `Migration pending: ${migration.description}${detail}`,
      { say: "Run it", command: "pal cli migrate", external: false }
    );
  });
}

export function updateFinding(cache: UpdateCache | null): Finding {
  if (!cache?.available) return passed("update", "PAL is up to date");

  return warning("update", `PAL ${cache.latest} is out (${cache.current} installed)`, {
    say: "Update",
    command: "pal cli update",
    external: false,
  });
}

export function healthFindings(): Finding[] {
  return [
    ...hookErrorFindings(recentHookErrors()),
    ...loginExpiryFindings(readLoginCache()),
    ...migrationFindings(checkPendingMigrations()),
    updateFinding(cachedStatus()),
  ];
}
