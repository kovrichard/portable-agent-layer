import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ServerStatus } from "../src/tools/ledger/server";
import type { LedgerView } from "../src/tools/ledger/view";

// The HTTP surface is small enough to pin completely: where it listens, what
// each route answers, and that a bad window is refused rather than widened.

let HOME: string;
let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-ledger-server-"));
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
  const { startLedgerServer } = await import("../src/tools/ledger/server");
  server = startLedgerServer(0);
  return `http://127.0.0.1:${server.port}`;
}

async function getView(url: string): Promise<LedgerView> {
  return (await (await fetch(url)).json()) as LedgerView;
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
  test("/ is the page", async () => {
    const base = await listen();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<table");
  });

  test("/api/ledger is the view", async () => {
    writeLedger([entry()]);
    const base = await listen();
    const body = await getView(`${base}/api/ledger`);
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
    const body = await getView(`${base}/api/ledger?since=2026-09-01&project=demo`);
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
    expect(await (await fetch(`${base}/api/projects`)).json()).toEqual([
      { slug: "alpha" },
      { slug: "zeta" },
    ]);
  });

  test("/api/status names this process and port", async () => {
    const base = await listen();
    const body = (await (await fetch(`${base}/api/status`)).json()) as ServerStatus;
    expect(body.pid).toBe(process.pid);
    expect(body.port).toBe(server?.port ?? -1);
    expect(typeof body.startedAt).toBe("string");
    expect(body.ledgerFiles).toBe(0);
  });

  test("anything else is a 404", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  test("it is read only", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/ledger`, { method: "POST" })).status).toBe(405);
  });
});
