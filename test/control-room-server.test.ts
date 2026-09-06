import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function registerProject(slug: string): void {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${slug}\nstatus: active\ncreated: 2026-09-01T00:00:00.000Z\nupdated: 2026-09-01T00:00:00.000Z\npath: ${HOME}\n---\n\n## Goal\n\nnone\n`,
    "utf-8"
  );
}

describe("where it listens", () => {
  test("loopback only", async () => {
    await listen();
    expect(server?.hostname).toBe("127.0.0.1");
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
