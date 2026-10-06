import { resolve } from "node:path";
import { cachedStatus, type UpdateCache } from "../../hooks/handlers/update-check";
import { loggedClaudeAuthMode } from "../../hooks/lib/inference";
import { type HookErrorGroup, recentHookErrors } from "../../hooks/lib/log";
import { palEnvPath } from "../../hooks/lib/pal-env";
import { palHome } from "../../hooks/lib/paths";
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

const CLAUDE_LOGIN_EXPIRED = /Failed to authenticate/;
const MINUTE_MS = 60_000;

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
    return warning(`hook-errors.${group.source}`, title, {
      say: `CLAUDE_CODE_OAUTH_TOKEN was rejected — it expired or is invalid. Create a new one and replace it in ${palEnvPath()}`,
      command: "claude setup-token",
      external: true,
    });
  return failing(`hook-errors.${group.source}`, title, {
    say: "Log the Claude CLI in again",
    command: "claude auth login",
    external: true,
  });
}

export function hookErrorFindings(
  groups: HookErrorGroup[],
  context: ErrorContext = { now: Date.now() }
): Finding[] {
  if (groups.length === 0)
    return [passed("hook-errors", "No hook errors in the last 24h")];
  const log = resolve(palHome(), "debug", "debug.log");
  return groups.map((group) => {
    if (CLAUDE_LOGIN_EXPIRED.test(group.last))
      return claudeLoginExpiredFinding(group, context);
    const times = group.count === 1 ? "once" : `${group.count} times`;
    return warning(
      `hook-errors.${group.source}`,
      `${group.source} failed ${times} in the last 24h, last ${ago(group.lastAt, context.now)}: ${group.last}`,
      { say: `Full trace in ${log}` }
    );
  });
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
    ...migrationFindings(checkPendingMigrations()),
    updateFinding(cachedStatus()),
  ];
}
