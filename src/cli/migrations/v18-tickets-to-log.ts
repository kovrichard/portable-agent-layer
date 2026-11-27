import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { storeLocation } from "../../bronze/bronze";
import { moveTicketsToLog, ticketLinesIn } from "../../progress/ticket-migration";
import type { Migration, MigrationResult } from "./migration";

/** Each project whose ISA.md still holds ticket lines, with how many. */
function projectsWithTicketLines(): { slug: string; dir: string; lines: number }[] {
  const base = storeLocation("project-history");
  if (!existsSync(base)) return [];

  return readdirSync(base)
    .map((slug) => ({ slug, dir: resolve(base, slug) }))
    .map((project) => ({ ...project, lines: ticketLinesIn(project.dir) }))
    .filter((project) => project.lines > 0);
}

export const v18TicketsToLog: Migration = {
  id: "v18-tickets-to-log",
  description: "Move project tickets out of ISA.md into each project's tickets.jsonl",

  check() {
    const pending = projectsWithTicketLines();

    return {
      pending: pending.length > 0,
      detail:
        pending.length > 0
          ? `${pending.length} project(s) hold tickets in ISA.md`
          : undefined,
    };
  },

  run(dryRun = false): MigrationResult {
    const pending = projectsWithTicketLines();
    const verb = dryRun ? "would move" : "moved";

    for (const project of pending)
      if (!dryRun) moveTicketsToLog(project.dir, project.slug);

    return {
      migrated: pending.length,
      skipped: 0,
      results: pending.map(
        (p) => `${p.slug}: ${verb} ${p.lines} ticket(s) to tickets.jsonl`
      ),
    };
  },
};
