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
import { PAGE_OUTCOMES } from "../ledger/outcomes";
import { type LedgerFilter, ledgerFiles, parseSince } from "../ledger/query";
import { ledgerView } from "../ledger/view";
import { attention, markRead } from "./attention";
import { agenda, agentsAtWork, board, handoffs, signal, summary } from "./data";
import { projectDetail } from "./detail";
import { matrix } from "./matrix";
import { type PrefUpdate, readPrefs, validatePrefs, writePrefs } from "./prefs";
import { DEFAULT_PORT, LOOPBACK } from "./server-config";
import { MAX_SNOOZE_DAYS, setSnooze } from "./snooze";
import { indexHtml, staticAsset } from "./static";
import {
  type InstallSettings,
  isQuadrant,
  QUADRANTS,
  readInstallSettings,
  setIscStatus,
  setPlacement,
  type WriteOutcome,
  writeInstallSettings,
} from "./writes";

export { DEFAULT_PORT, LOOPBACK };

/**
 * Every path the single-page app owns. Listed rather than wildcarded, because a
 * blanket "/*" outranks the fetch handler and would swallow /api as well.
 */
const PAGE_ROUTES = ["/", "/projects", "/projects/:slug", "/log", "/settings"];

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

const AUTHORITIES: readonly string[] = ["user", "agent"];

/**
 * Free-form on the record, so the page may name any of them: a runtime or
 * machine label PAL has never seen simply matches nothing.
 */
const PASSTHROUGH = ["project", "runtime", "machine", "actor", "tool"] as const;

/**
 * A window the page cannot parse is an error, not the whole ledger. The same
 * goes for a closed set it spells wrong — silently answering with every row
 * would read as "no such filter" rather than "no such value".
 */
function filterFromQuery(params: URLSearchParams): LedgerFilter | string {
  const filter: LedgerFilter = {};
  for (const key of PASSTHROUGH) {
    const value = params.get(key);
    if (value) filter[key] = value;
  }
  for (const key of ["since", "until"] as const) {
    const spec = params.get(key);
    if (!spec) continue;
    const at = parseSince(spec);
    if (!at) return `Unrecognised ${key}: ${spec}`;
    filter[key] = at;
  }
  const outcome = params.get("outcome");
  if (outcome) {
    if (!(PAGE_OUTCOMES as readonly string[]).includes(outcome)) {
      return `Unrecognised outcome: ${outcome}`;
    }
    filter.outcome = outcome;
  }
  const authority = params.get("authority");
  if (authority) {
    if (!AUTHORITIES.includes(authority)) return `Unrecognised authority: ${authority}`;
    filter.authority = authority;
  }
  return filter;
}

function projects(): Response {
  const slugs = readAllProjects()
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  return json(slugs.map((slug) => ({ slug })));
}

function oneProject(slug: string | null): Response {
  if (!slug) return json({ error: "slug is required" }, 400);
  const detail = projectDetail(slug);
  return detail ? json(detail) : json({ error: `no such project: ${slug}` }, 404);
}

const SUMMARY_DAYS_DEFAULT = 14;
const SUMMARY_DAYS_MAX = 365;

function summaryFor(spec: string | null): Response {
  const days = spec ? Number(spec) : SUMMARY_DAYS_DEFAULT;
  if (!Number.isInteger(days) || days < 1 || days > SUMMARY_DAYS_MAX) {
    return json({ error: `days must be a whole number of 1..${SUMMARY_DAYS_MAX}` }, 400);
  }
  return json(summary(days));
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

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function answer(outcome: WriteOutcome, body: Record<string, unknown>): Response {
  return outcome.ok
    ? json({ ...body, changed: outcome.changed })
    : json({ error: outcome.error }, outcome.status);
}

/** Close or reopen one criterion — the same rule `complete-isc` reaches. */
async function iscWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const { project, id, status } = body;
  if (typeof project !== "string" || !project) {
    return json({ error: "project is required" }, 400);
  }
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    return json({ error: "id must be a positive integer" }, 400);
  }
  if (status !== "open" && status !== "done") {
    return json({ error: "status must be open or done" }, 400);
  }
  return answer(setIscStatus(project, id, status === "done"), { project, id, status });
}

async function placementWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const { project, quadrant } = body;
  if (typeof project !== "string" || !project) {
    return json({ error: "project is required" }, 400);
  }
  if (quadrant !== null && !isQuadrant(quadrant)) {
    return json(
      { error: `quadrant must be null or one of ${QUADRANTS.join(", ")}` },
      400
    );
  }
  return answer(setPlacement(project, quadrant), { project, quadrant });
}

async function settingsWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const update: Partial<InstallSettings> = {};
  for (const key of ["actor", "timezone"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return json({ error: `${key} must be a string` }, 400);
    update[key] = value;
  }
  const outcome = writeInstallSettings(update);
  return outcome.ok ? json(readInstallSettings()) : answer(outcome, {});
}

async function snoozeWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const { project, id, days } = body;
  if (typeof project !== "string" || !project) {
    return json({ error: "project is required" }, 400);
  }
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    return json({ error: "id must be a positive integer" }, 400);
  }
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 0 ||
    days > MAX_SNOOZE_DAYS
  ) {
    return json({ error: `days must be a whole number of 0..${MAX_SNOOZE_DAYS}` }, 400);
  }
  return json({ project, id, until: setSnooze(project, id, days) });
}

async function readWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const ids = body.all === true ? attention().items.map((i) => i.id) : body.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return json({ error: "ids must be an array of strings, or all must be true" }, 400);
  }
  return json({ marked: markRead(ids as string[]) });
}

async function prefsWrite(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const failure = validatePrefs(body as PrefUpdate);
  return failure ? json({ error: failure }, 400) : json(writePrefs(body as PrefUpdate));
}

const WRITES: Record<string, (request: Request) => Promise<Response>> = {
  "/api/serves": overrideServes,
  "/api/isc": iscWrite,
  "/api/placement": placementWrite,
  "/api/settings": settingsWrite,
  "/api/snooze": snoozeWrite,
  "/api/attention/read": readWrite,
  "/api/prefs": prefsWrite,
};

export function startControlRoom(port: number = DEFAULT_PORT) {
  const startedAt = new Date().toISOString();
  return Bun.serve({
    hostname: LOOPBACK,
    port,
    development: false,
    routes: Object.fromEntries(PAGE_ROUTES.map((path) => [path, () => indexHtml()])),
    fetch(request, server) {
      const url = new URL(request.url);
      const write = WRITES[url.pathname];
      if (request.method === "POST" && write) return write(request);
      if (request.method !== "GET") return json({ error: "read only" }, 405);
      if (!url.pathname.startsWith("/api/")) {
        return staticAsset(url.pathname) ?? json({ error: "not found" }, 404);
      }
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
        case "/api/project":
          return oneProject(url.searchParams.get("slug"));
        case "/api/summary":
          return summaryFor(url.searchParams.get("days"));
        case "/api/projects":
          return projects();
        case "/api/settings":
          return json(readInstallSettings());
        case "/api/prefs":
          return json(readPrefs());
        case "/api/attention":
          return json(attention());
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
