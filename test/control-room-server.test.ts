import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
  AgendaView,
  AgentsView,
  ProjectCard,
  SignalView,
} from "../src/tools/control-room/data";
import type { Matrix } from "../src/tools/control-room/matrix";
import type { ServerStatus } from "../src/tools/control-room/server";
import type { LedgerView } from "../src/tools/ledger/view";

// The HTTP surface is small enough to pin completely: where it listens, what
// each route answers, and that a bad window is refused rather than widened.

let HOME: string;
let server: ReturnType<typeof Bun.serve> | null = null;

// The page is a build artifact rather than source, so the suite builds it once
// instead of asserting against whatever a previous run happened to leave behind.
beforeAll(async () => {
  const { buildPage, isBuilt } = await import("../src/tools/control-room/static");
  if (!isBuilt()) expect(buildPage()).toBe(true);
});

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-control-room-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "ledger"), { recursive: true });
});

afterEach(() => {
  server?.stop(true);
  server = null;
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function listen(): Promise<string> {
  const { startControlRoom } = await import("../src/tools/control-room/server");
  server = startControlRoom(0);
  return `http://127.0.0.1:${server.port}`;
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

function writeLedger(rows: Record<string, unknown>[]): void {
  writeFileSync(
    resolve(HOME, "memory", "ledger", "actions.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf-8"
  );
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "id-1",
    ts: "2026-09-04T12:00:00.000Z",
    machine: "machine-a",
    actor: "actor-a",
    runtime: "claude",
    authority: "user",
    tool: "Edit",
    target: "{proj:demo}/src/a.ts",
    outcome: "applied",
    before: { hash: "b", bytes: 1 },
    after: { hash: "a", bytes: 2 },
    delta: { hunks: [{ at: 0, remove: 0, insert: ["x"] }] },
    ...overrides,
  };
}

function registerProject(slug: string, body = "## Goal\n\nnone\n"): void {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${slug}\nstatus: active\ncreated: 2026-09-01T00:00:00.000Z\nupdated: 2026-09-01T00:00:00.000Z\npath: ${HOME}\n---\n\n${body}`,
    "utf-8"
  );
}

describe("where it listens", () => {
  test("loopback only", async () => {
    await listen();
    expect(server?.hostname).toBe("127.0.0.1");
  });

  test("vite proxies /api to the port the server actually uses", async () => {
    const { DEFAULT_PORT } = await import("../src/tools/control-room/server-config");
    const config = readFileSync(
      resolve(import.meta.dir, "..", "src/tools/control-room/ui/vite.config.ts"),
      "utf-8"
    );
    expect(config).toContain(`127.0.0.1:${DEFAULT_PORT}`);
  });
});

describe("what each route answers", () => {
  test("/ is the bundled page, not a template", async () => {
    const base = await listen();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).not.toContain("app.tsx");
  });

  test("/api/ledger is the view", async () => {
    writeLedger([entry()]);
    const base = await listen();
    const body = await getJson<LedgerView>(`${base}/api/ledger`);
    expect(body.stats.outcomes.applied.total).toBe(1);
    expect(body.rows[0].target).toBe("demo /src/a.ts");
    expect(body.window).toEqual({ since: null, until: null });
  });

  test("/api/ledger narrows by since and project", async () => {
    writeLedger([
      entry({ id: "old", ts: "2026-08-01T00:00:00.000Z" }),
      entry({ id: "new", ts: "2026-09-04T00:00:00.000Z" }),
      entry({
        id: "elsewhere",
        ts: "2026-09-04T00:00:00.000Z",
        target: "{proj:other}/x",
      }),
    ]);
    const base = await listen();
    const body = await getJson<LedgerView>(
      `${base}/api/ledger?since=2026-09-01&project=demo`
    );
    expect(body.rows.map((r) => r.id)).toEqual(["new"]);
    expect(body.window.since).toBe("2026-09-01T00:00:00.000Z");
  });

  test("a window it cannot parse is a 400, not the whole ledger", async () => {
    writeLedger([entry()]);
    const base = await listen();
    const res = await fetch(`${base}/api/ledger?since=yesterday-ish`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("since");
  });

  test("/api/projects lists registered slugs, sorted", async () => {
    registerProject("zeta");
    registerProject("alpha");
    const base = await listen();
    expect(await getJson<{ slug: string }[]>(`${base}/api/projects`)).toEqual([
      { slug: "alpha" },
      { slug: "zeta" },
    ]);
  });

  test("/api/board is one card per registered project", async () => {
    registerProject("alpha");
    const base = await listen();
    const cards = await getJson<ProjectCard[]>(`${base}/api/board`);
    expect(cards.map((c) => c.slug)).toEqual(["alpha"]);
    expect(cards[0].path).toBe(HOME);
  });

  test("/api/handoffs is empty when nothing is in progress", async () => {
    const base = await listen();
    expect(await getJson<unknown[]>(`${base}/api/handoffs`)).toEqual([]);
  });

  test("/api/signal always carries the three badges", async () => {
    const base = await listen();
    const body = await getJson<SignalView>(`${base}/api/signal`);
    expect(Object.keys(body.due).sort()).toEqual([
      "algorithmReview",
      "analysis",
      "relationshipReflect",
    ]);
    expect(body.series).toEqual([]);
  });

  test("/api/agents takes the same window as the ledger", async () => {
    writeLedger([entry({ ts: "2026-09-04T00:00:00.000Z" })]);
    const base = await listen();
    const body = await getJson<AgentsView>(`${base}/api/agents?since=2026-09-01`);
    expect(body.since).toBe("2026-09-01T00:00:00.000Z");
    expect(body.projects.map((p) => p.slug)).toEqual(["demo"]);
    expect((await fetch(`${base}/api/agents?since=nonsense`)).status).toBe(400);
  });

  test("/api/status names this process and port", async () => {
    const base = await listen();
    const body = await getJson<ServerStatus>(`${base}/api/status`);
    expect(body.pid).toBe(process.pid);
    expect(body.port).toBe(server?.port ?? -1);
    expect(typeof body.startedAt).toBe("string");
    expect(body.ledgerFiles).toBe(0);
  });

  test("/api/agenda says how old the file on disk is", async () => {
    const base = await listen();
    const empty = await getJson<AgendaView>(`${base}/api/agenda`);
    expect(empty).toEqual({
      moves: [],
      generatedAt: null,
      ageHours: null,
      stale: true,
    });

    writeFileSync(
      resolve(HOME, "memory", "state", "agenda.json"),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        moves: [{ move: "Send the one-pager", because: "blocked on you" }],
      }),
      "utf-8"
    );
    const fresh = await getJson<AgendaView>(`${base}/api/agenda`);
    expect(fresh.moves).toHaveLength(1);
    expect(fresh.stale).toBe(false);
  });

  test("/api/matrix is the four quadrants", async () => {
    registerProject("alpha");
    const base = await listen();
    const grid = await getJson<Matrix>(`${base}/api/matrix`);
    expect(Object.keys(grid).sort()).toEqual([
      "later",
      "noise",
      "now",
      "plan",
      "unranked",
    ]);
    expect(grid.unranked).toBe(1);
  });

  test("anything else is a 404", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  test("/api/ledger narrows by runtime, machine and authority", async () => {
    writeLedger([
      entry({ id: "a", runtime: "claude", machine: "mbp", authority: "user" }),
      entry({ id: "b", runtime: "codex", machine: "mbp", authority: "agent" }),
      entry({ id: "c", runtime: "claude", machine: "studio", authority: "agent" }),
    ]);
    const base = await listen();
    const ids = async (query: string) =>
      (await getJson<LedgerView>(`${base}/api/ledger?${query}`)).rows
        .map((r) => r.id)
        .sort();

    expect(await ids("runtime=claude")).toEqual(["a", "c"]);
    expect(await ids("machine=mbp")).toEqual(["a", "b"]);
    expect(await ids("authority=agent")).toEqual(["b", "c"]);
    expect(await ids("runtime=claude&authority=agent")).toEqual(["c"]);
  });

  test("a value outside a closed set is a 400, not an empty answer", async () => {
    writeLedger([entry()]);
    const base = await listen();
    expect((await fetch(`${base}/api/ledger?outcome=exploded`)).status).toBe(400);
    expect((await fetch(`${base}/api/ledger?authority=nobody`)).status).toBe(400);
    expect((await fetch(`${base}/api/ledger?outcome=blocked`)).status).toBe(200);
  });

  test("a ledger row names the machine that wrote it", async () => {
    writeLedger([entry({ machine: "machine-a" })]);
    const base = await listen();
    const body = await getJson<LedgerView>(`${base}/api/ledger`);
    expect(body.rows[0].machine).toBeTruthy();
  });

  test("/api/summary counts one window", async () => {
    const justNow = new Date().toISOString();
    writeLedger([
      entry({ id: "kept", ts: justNow }),
      entry({ id: "refused", ts: justNow, outcome: "denied" }),
    ]);
    const base = await listen();
    const body = await getJson<{ days: number; actions: number; refusals: number }>(
      `${base}/api/summary?days=30`
    );
    expect(body.actions).toBe(2);
    expect(body.refusals).toBe(1);
  });

  test("/api/summary refuses a window it cannot count", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/summary?days=0`)).status).toBe(400);
    expect((await fetch(`${base}/api/summary?days=half`)).status).toBe(400);
  });
});

describe("one project", () => {
  test("/api/project carries the criteria, decisions and context", async () => {
    registerProject(
      "demo",
      [
        "## Goal",
        "",
        "Ship the thing.",
        "",
        "## Criteria",
        "",
        "- [ ] ISC-1: still open",
        "- [x] ISC-2: finished",
        "",
        "## Decisions",
        "",
        "- 2026-09-04: Paths live in bindings.json (records travel, disks don't)",
        "",
        "## Context",
        "",
        "- Bun only, no Node",
        "",
      ].join("\n")
    );
    const base = await listen();
    const body = await getJson<{
      slug: string;
      iscs: { id: number; status: string }[];
      decisions: { date: string | null; text: string; why: string | null }[];
      context: string[];
    }>(`${base}/api/project?slug=demo`);

    expect(body.slug).toBe("demo");
    expect(body.iscs.map((i) => i.status)).toEqual(["open", "done"]);
    expect(body.decisions[0]).toEqual({
      date: "2026-09-04",
      text: "Paths live in bindings.json",
      why: "records travel, disks don't",
    });
    expect(body.context).toEqual(["Bun only, no Node"]);
  });

  test("an unknown slug is a 404, and a missing one a 400", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/project?slug=ghost`)).status).toBe(404);
    expect((await fetch(`${base}/api/project`)).status).toBe(400);
  });
});

async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface DetailBody {
  iscs: { id: number; status: string }[];
  placed: string | null;
}

describe("what the page may change", () => {
  const withCriteria =
    "## Criteria\n\n- [ ] ISC-1: the open one\n- [ ] ISC-2: the other\n";

  test("closing an ISC archives it, and reopening walks it back", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    const statuses = async () =>
      (await getJson<DetailBody>(`${base}/api/project?slug=demo`)).iscs.map(
        (i) => `${i.id}:${i.status}`
      );

    expect(await statuses()).toEqual(["1:open", "2:open"]);

    expect(
      (await post(base, "/api/isc", { project: "demo", id: 1, status: "done" })).ok
    ).toBe(true);
    expect(await statuses()).toEqual(["2:open", "1:done"]);

    expect(
      (await post(base, "/api/isc", { project: "demo", id: 1, status: "open" })).ok
    ).toBe(true);
    expect(await statuses()).toEqual(["2:open", "1:open"]);
  });

  test("closing one that is already closed changes nothing and says so", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    await post(base, "/api/isc", { project: "demo", id: 1, status: "done" });
    const again = await post(base, "/api/isc", {
      project: "demo",
      id: 1,
      status: "done",
    });
    expect(await again.json()).toMatchObject({ changed: false });
  });

  test("an ISC write refuses what it cannot act on", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    expect((await post(base, "/api/isc", { id: 1, status: "done" })).status).toBe(400);
    expect(
      (await post(base, "/api/isc", { project: "demo", id: 0, status: "done" })).status
    ).toBe(400);
    expect(
      (await post(base, "/api/isc", { project: "demo", id: 1, status: "maybe" })).status
    ).toBe(400);
    expect(
      (await post(base, "/api/isc", { project: "ghost", id: 1, status: "done" })).status
    ).toBe(404);
    expect(
      (await post(base, "/api/isc", { project: "demo", id: 99, status: "done" })).status
    ).toBe(404);
  });

  test("a placement overrules the grid's own guess and survives on the record", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    const quadrantOf = async () => {
      const grid = await getJson<Matrix>(`${base}/api/matrix`);
      for (const key of ["now", "plan", "noise", "later"] as const) {
        if (grid[key].some((i) => i.id === "demo")) return key;
      }
      return null;
    };

    expect(await quadrantOf()).toBe("later");
    expect(
      (await post(base, "/api/placement", { project: "demo", quadrant: "now" })).ok
    ).toBe(true);
    expect(await quadrantOf()).toBe("now");

    const detail = await getJson<DetailBody>(`${base}/api/project?slug=demo`);
    expect(detail.placed).toBe("now");

    await post(base, "/api/placement", { project: "demo", quadrant: null });
    expect(await quadrantOf()).toBe("later");
  });

  test("a placement refuses a quadrant that is not one", async () => {
    registerProject("demo", withCriteria);
    const base = await listen();
    expect(
      (await post(base, "/api/placement", { project: "demo", quadrant: "soon" })).status
    ).toBe(400);
    expect(
      (await post(base, "/api/placement", { project: "ghost", quadrant: "now" })).status
    ).toBe(404);
  });

  test("settings read back what they were given, and refuse a bad timezone", async () => {
    const base = await listen();
    const saved = await post(base, "/api/settings", {
      actor: "richard",
      timezone: "Europe/Budapest",
    });
    expect(await saved.json()).toEqual({ actor: "richard", timezone: "Europe/Budapest" });
    expect(await getJson<Record<string, string>>(`${base}/api/settings`)).toEqual({
      actor: "richard",
      timezone: "Europe/Budapest",
    });
    expect(
      (await post(base, "/api/settings", { timezone: "Mars/Olympus_Mons" })).status
    ).toBe(400);
  });
});

describe("how the page itself is served", () => {
  test("a deep link into the page is served the page, not a 404", async () => {
    const base = await listen();
    for (const path of ["/", "/projects", "/projects/portable-agent-layer", "/log"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });

  test("the page routes never shadow the API", async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/status`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("it is read only apart from the one override", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/ledger`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/api/serves`, { method: "DELETE" })).status).toBe(405);
  });
});

describe("the one thing the page may change", () => {
  async function post(base: string, body: unknown): Promise<Response> {
    return fetch(`${base}/api/serves`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  test("an override is written as the user's own answer", async () => {
    registerProject("alpha");
    const base = await listen();
    const res = await post(base, { project: "alpha", serves: "revenue", note: "a bet" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: "alpha", serves: "revenue", by: "user" });

    const grid = await getJson<Matrix>(`${base}/api/matrix`);
    const item = grid.plan.find((i) => i.id === "alpha");
    expect(item?.serves).toBe("revenue");
    expect(item?.servesBy).toBe("user");
    expect(grid.unranked).toBe(0);
  });

  test("it refuses a kind that is not one of the three", async () => {
    registerProject("alpha");
    const base = await listen();
    const res = await post(base, { project: "alpha", serves: "important" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("goal, revenue");
  });

  test("it refuses a body with no project", async () => {
    const base = await listen();
    expect((await post(base, { serves: "fun" })).status).toBe(400);
    expect((await post(base, "not json at all")).status).toBe(400);
  });

  test("an unknown project is a 404, not a new record", async () => {
    const base = await listen();
    expect((await post(base, { project: "ghost", serves: "fun" })).status).toBe(404);
    expect(await getJson<{ slug: string }[]>(`${base}/api/projects`)).toEqual([]);
  });
});
