/**
 * The control room — one local page over ~/.pal, meant to be opened before a
 * terminal. Loopback only, read only, no state of its own: every request goes
 * back to the files.
 *
 * `pal cli server start|stop|status` owns the process; this file only serves.
 */

import { loadMachine } from "../../hooks/lib/machine";
import { readAllProjects } from "../../hooks/lib/projects";
import { isServesKind, setServes } from "../../hooks/lib/serves";
import { type LedgerFilter, ledgerFiles, parseSince } from "../ledger/query";
import { ledgerView } from "../ledger/view";
import { agenda, agentsAtWork, board, handoffs, signal } from "./data";
import { matrix } from "./matrix";
import index from "./ui/index.html";

export const DEFAULT_PORT = 7250;
export const LOOPBACK = "127.0.0.1";

/**
 * Every path the single-page app owns. Listed rather than wildcarded, because a
 * blanket "/*" outranks the fetch handler and would swallow /api as well.
 */
const PAGE_ROUTES = ["/", "/projects", "/projects/:slug", "/log"];

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

function projects(): Response {
  const slugs = readAllProjects()
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  return json(slugs.map((slug) => ({ slug })));
}

function withFilter(url: URL, view: (filter: LedgerFilter) => unknown): Response {
  const filter = filterFromQuery(url.searchParams);
  if (typeof filter === "string") return json({ error: filter }, 400);
  return json(view(filter));
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

/**
 * The one thing the page may change. Importance is a guess until the user
 * corrects it, and a correction is worth one click — but this stays a single
 * named field on a single record, not a write surface over ~/.pal.
 */
async function overrideServes(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }
  const { project, serves, note } = (body ?? {}) as Record<string, unknown>;
  if (typeof project !== "string" || !project) {
    return json({ error: "project is required" }, 400);
  }
  if (!isServesKind(serves)) {
    return json({ error: "serves must be goal, revenue or fun" }, 400);
  }

  const outcome = setServes({
    name: project,
    kind: serves,
    note: typeof note === "string" && note ? note : undefined,
    by: "user",
  });
  if (outcome === "missing") return json({ error: `no such project: ${project}` }, 404);
  return json({ project, serves, by: "user" });
}

export function startControlRoom(port: number = DEFAULT_PORT) {
  const startedAt = new Date().toISOString();
  return Bun.serve({
    hostname: LOOPBACK,
    port,
    development: false,
    routes: Object.fromEntries(PAGE_ROUTES.map((path) => [path, index])),
    fetch(request, server) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/api/serves") {
        return overrideServes(request);
      }
      if (request.method !== "GET") return json({ error: "read only" }, 405);
      switch (url.pathname) {
        case "/api/agenda":
          return json(agenda());
        case "/api/matrix":
          return json(matrix());
        case "/api/board":
          return json(board());
        case "/api/handoffs":
          return json(handoffs());
        case "/api/signal":
          return json(signal());
        case "/api/agents":
          return withFilter(url, agentsAtWork);
        case "/api/ledger":
          return withFilter(url, ledgerView);
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
  const server = startControlRoom(portFromArgv(process.argv.slice(2)));
  console.log(`http://${LOOPBACK}:${server.port}/`);
}
