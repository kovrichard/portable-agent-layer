/**
 * Moves the ticket lines an ISA.md still holds into the project's log. The
 * frontmatter is written back as it was stored, so two machines moving the same
 * ISA.md write the same bytes.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, stringify } from "../core/frontmatter";
import { buildBody, extractSections } from "./isa-body";
import { parseIscs } from "./isc-line";
import {
  pendingImports,
  type TicketSections,
  ticketLogIn,
  withoutTickets,
} from "./tickets";

interface StoredIsa {
  meta: Record<string, unknown>;
  sections: ReturnType<typeof extractSections>;
  tickets: TicketSections;
}

function readIsa(projectDir: string): StoredIsa | null {
  const file = resolve(projectDir, "ISA.md");
  if (!existsSync(file)) return null;
  const { meta, body } = parse<Record<string, unknown>>(readFileSync(file, "utf-8"));
  const sections = extractSections(body);
  const tickets = {
    criteria: sections.criteria ?? "",
    changelog: sections.changelog ?? "",
  };

  return { meta, sections, tickets };
}

/** How many ticket lines the ISA.md in this folder still holds. */
export function ticketLinesIn(projectDir: string): number {
  const isa = readIsa(projectDir);
  if (!isa) return 0;

  return [...parseIscs(isa.tickets.criteria), ...parseIscs(isa.tickets.changelog)].length;
}

export function moveTicketsToLog(projectDir: string, slug: string): void {
  const isa = readIsa(projectDir);
  if (!isa) return;
  const log = ticketLogIn(projectDir);
  const owner = { name: slug, created: String(isa.meta.created ?? "") };
  const lines = pendingImports(
    existsSync(log) ? readFileSync(log, "utf-8") : "",
    owner,
    isa.tickets
  );
  if (lines.length > 0) appendFileSync(log, lines.map((line) => `${line}\n`).join(""));
  const body = buildBody({
    ...isa.sections,
    criteria: withoutTickets(isa.tickets.criteria),
    changelog: withoutTickets(isa.tickets.changelog),
  });
  writeFileSync(resolve(projectDir, "ISA.md"), stringify(isa.meta, body), "utf-8");
}
