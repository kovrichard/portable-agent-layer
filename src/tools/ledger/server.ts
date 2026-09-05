/**
 * A local page over the ledger, for showing the action log to someone who
 * will not read a terminal.
 *
 * Loopback only, stateless, no store of its own: every request reads the
 * ledger afresh through the same query the CLI uses, so the page and
 * `pal cli ledger` can never disagree. The browser holds nothing but the
 * current filter selection.
 */

import { readFileSync } from "node:fs";
import { loadMachine } from "../../hooks/lib/machine";
import { assets } from "../../hooks/lib/paths";
import { readAllProjects } from "../../hooks/lib/projects";
import { type LedgerFilter, ledgerFiles, parseSince } from "./query";
import { ledgerView } from "./view";

export const DEFAULT_PORT = 7250;
export const LOOPBACK = "127.0.0.1";

export interface ServerStatus {
  pid: number;
  port: number;
  startedAt: string;
  ledgerFiles: number;
  machine: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** A window the page cannot parse is an error, not the whole ledger. */
function filterFromQuery(params: URLSearchParams): LedgerFilter | string {
  const filter: LedgerFilter = {};
  const project = params.get("project");
  if (project) filter.project = project;
  for (const key of ["since", "until"] as const) {
    const spec = params.get(key);
    if (!spec) continue;
    const at = parseSince(spec);
    if (!at) return `Unrecognised ${key}: ${spec}`;
    filter[key] = at;
  }
  return filter;
}

function page(): Response {
  return new Response(readFileSync(assets.ledgerPageTemplate()), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function projects(): Response {
  const slugs = readAllProjects()
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  return json(slugs.map((slug) => ({ slug })));
}

function ledger(url: URL): Response {
  const filter = filterFromQuery(url.searchParams);
  if (typeof filter === "string") return json({ error: filter }, 400);
  return json(ledgerView(filter));
}

function status(port: number, startedAt: string): Response {
  const body: ServerStatus = {
    pid: process.pid,
    port,
    startedAt,
    ledgerFiles: ledgerFiles().length,
    machine: loadMachine().label,
  };
  return json(body);
}

export function startLedgerServer(port: number = DEFAULT_PORT) {
  const startedAt = new Date().toISOString();
  return Bun.serve({
    hostname: LOOPBACK,
    port,
    fetch(request, server) {
      if (request.method !== "GET") return json({ error: "read only" }, 405);
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/":
          return page();
        case "/api/ledger":
          return ledger(url);
        case "/api/projects":
          return projects();
        case "/api/status":
          return status(server.port ?? port, startedAt);
        default:
          return json({ error: "not found" }, 404);
      }
    },
  });
}

function portFromArgv(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith("--port="));
  const port = flag ? Number(flag.slice("--port=".length)) : DEFAULT_PORT;
  return Number.isInteger(port) && port >= 0 ? port : DEFAULT_PORT;
}

if (import.meta.main) {
  const server = startLedgerServer(portFromArgv(process.argv.slice(2)));
  console.log(`http://${LOOPBACK}:${server.port}/`);
}
