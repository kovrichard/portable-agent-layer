import { resolve } from "node:path";
import { cachedStatus, type UpdateCache } from "../../hooks/handlers/update-check";
import { type HookErrorGroup, recentHookErrors } from "../../hooks/lib/log";
import { palHome } from "../../hooks/lib/paths";
import { checkPendingMigrations } from "../migrate";
import { type Finding, passed, warning } from "./finding";

interface PendingMigration {
  id: string;
  description: string;
  detail?: string;
}

export function hookErrorFindings(groups: HookErrorGroup[]): Finding[] {
  if (groups.length === 0)
    return [passed("hook-errors", "No hook errors in the last 24h")];
  const log = resolve(palHome(), "debug", "debug.log");
  return groups.map((group) => {
    const times = group.count === 1 ? "once" : `${group.count} times`;
    return warning(
      `hook-errors.${group.source}`,
      `${group.source} failed ${times} in the last 24h — last: ${group.last}`,
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
      { say: "Run it", command: "pal cli migrate" }
    );
  });
}

export function updateFinding(cache: UpdateCache | null): Finding {
  if (!cache?.available) return passed("update", "PAL is up to date");
  return warning("update", `PAL ${cache.latest} is out (${cache.current} installed)`, {
    say: "Update",
    command: "pal cli update",
  });
}

export function healthFindings(): Finding[] {
  return [
    ...hookErrorFindings(recentHookErrors()),
    ...migrationFindings(checkPendingMigrations()),
    updateFinding(cachedStatus()),
  ];
}
