import { resolve } from "node:path";
import { eventsSince } from "../../bronze/events";
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
  ownerRun: boolean;
}

interface ErrorContext {
  now: number;
  lastClaudeSuccessAt?: () => number;
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
  if ((context.lastClaudeSuccessAt?.() ?? 0) > group.lastAt)
    return passed(
      `hook-errors.${group.source}`,
      `Background calls to Claude log in again — the last failed login was ${ago(group.lastAt, context.now)}`
    );

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

const MOVES_EXPLAINED =
  "they move your data, so they run only when you start them: PAL must be idle, a verified backup is taken first, every file is hash-checked, and pal cli migrate --undo <id> puts it back. PAL reads the old folders until then. PAL 1.0 needs every one of them";

function ownerMovesFinding(pending: PendingMigration[]): Finding[] {
  const count = pending.filter((migration) => migration.ownerRun).length;
  if (count === 0) return [];
  const moves = count === 1 ? "1 data move waits" : `${count} data moves wait`;

  return [
    {
      ...warning(
        "owner-migrations",
        `${moves} for you, required before PAL 1.0 — ${MOVES_EXPLAINED}`,
        { say: "Close your other agent sessions, then run each one below" }
      ),
      notice: `${moves} for you, required before PAL 1.0`,
    },
  ];
}

export function migrationFindings(pending: PendingMigration[]): Finding[] {
  if (pending.length === 0) return [passed("migrations", "No pending migrations")];

  return [...ownerMovesFinding(pending), ...pendingMigrationFindings(pending)];
}

function pendingMigrationFindings(pending: PendingMigration[]): Finding[] {
  return pending.map((migration) => {
    const detail = migration.detail ? ` (${migration.detail})` : "";

    if (migration.ownerRun)
      return warning(
        `owner-migration.${migration.id}`,
        `Waiting for you to run it: ${migration.description}`,
        { say: "Run it", command: `pal cli migrate ${migration.id}`, external: false }
      );

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

const DAY_MS = 24 * 60 * MINUTE_MS;

export function lastClaudeSuccessAt(now: number): number {
  return eventsSince("inference_call", new Date(now - DAY_MS))
    .filter((call) => String(call.route ?? "").startsWith("claude") && !call.failure)
    .reduce((latest, call) => Math.max(latest, Date.parse(call.ts)), 0);
}

export function healthFindings(): Finding[] {
  const now = Date.now();

  return [
    ...hookErrorFindings(recentHookErrors(), {
      now,
      lastClaudeSuccessAt: () => lastClaudeSuccessAt(now),
    }),
    ...loginExpiryFindings(readLoginCache()),
    ...migrationFindings(checkPendingMigrations()),
    updateFinding(cachedStatus()),
  ];
}
