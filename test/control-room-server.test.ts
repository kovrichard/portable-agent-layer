import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AutoUpdateStatus } from "../src/hooks/lib/auto-update";
import type {
  AgendaView,
  AgentsView,
  ProjectCard,
  SignalView,
} from "../src/tools/control-room/data";
import type { Matrix } from "../src/tools/control-room/matrix";
import type { ServerStatus } from "../src/tools/control-room/server";
import type { LedgerView } from "../src/tools/ledger/view";
import {
  controlRoomHome,
  controlRoomPerTest,
  getJson,
  listen,
  post,
  registerProject,
  runningServer,
} from "./lib/control-room-server-fixture";
import { seedWorkNode } from "./lib/work-node-fixture";

// The HTTP surface is small enough to pin completely: where it listens, what
// each route answers, and that a bad window is refused rather than widened.

controlRoomPerTest(import.meta.file);

function writeLedger(rows: Record<string, unknown>[]): void {
  writeFileSync(
    resolve(controlRoomHome(), "memory", "ledger", "actions.jsonl"),
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

describe("where it listens", () => {
  test("loopback only", async () => {
    await listen();
    expect(runningServer()?.hostname).toBe("127.0.0.1");
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
    expect(cards[0].path).toBe(controlRoomHome());
  });

  test("/api/work is empty when nothing is in progress", async () => {
    const base = await listen();
    expect(await getJson<unknown[]>(`${base}/api/work`)).toEqual([]);
  });

  test("/api/work lists fresh open nodes from the progress tree", async () => {
    seedWorkNode("demo", "a", { at: new Date().toISOString(), stoppedAt: "half way" });
    const base = await listen();
    const cards = await getJson<{ node: string; stoppedAt: string }[]>(
      `${base}/api/work`
    );
    expect(cards.map((c) => [c.node, c.stoppedAt])).toEqual([["a", "half way"]]);
  });

  test("/api/signal always carries the two badges", async () => {
    const base = await listen();
    const body = await getJson<SignalView>(`${base}/api/signal`);
    expect(Object.keys(body.due).sort()).toEqual(["algorithmReview", "analysis"]);
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
    expect(body.port).toBe(runningServer()?.port ?? -1);
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
      resolve(controlRoomHome(), "memory", "state", "agenda.json"),
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

describe("what the page may change", () => {
  const withCriteria =
    "## Criteria\n\n- [ ] ISC-1: the open one\n- [ ] ISC-2: the other\n";

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

interface AttentionBody {
  unread: number;
  items: { id: string; source: string; title: string; read: boolean }[];
}

describe("what needs your attention", () => {
  test("a refusal, a node waiting on you and an unranked project all light it", async () => {
    const justNow = new Date().toISOString();
    writeLedger([
      entry({ id: "refused", ts: justNow, outcome: "denied", reason: "you said no" }),
    ]);
    registerProject("demo");
    seedWorkNode("demo", "w", {
      at: justNow,
      status: "waiting",
      waitingOn: "which policy?",
    });

    const base = await listen();
    const body = await getJson<AttentionBody>(`${base}/api/attention`);
    expect([...new Set(body.items.map((i) => i.source))].sort()).toEqual([
      "refusals",
      "unranked",
      "waiting",
    ]);
    expect(body.unread).toBe(body.items.length);
  });

  test("marking one read leaves the rest unread", async () => {
    registerProject("demo");
    const base = await listen();
    const before = await getJson<AttentionBody>(`${base}/api/attention`);
    expect(before.unread).toBeGreaterThan(0);

    await post(base, "/api/attention/read", { ids: [before.items[0].id] });
    const after = await getJson<AttentionBody>(`${base}/api/attention`);
    expect(after.unread).toBe(before.unread - 1);
    expect(after.items.find((i) => i.id === before.items[0].id)?.read).toBe(true);
  });

  test("a source switched off stops contributing", async () => {
    registerProject("demo");
    const base = await listen();
    expect(
      (await getJson<AttentionBody>(`${base}/api/attention`)).items.some(
        (i) => i.source === "unranked"
      )
    ).toBe(true);

    await post(base, "/api/prefs", { attention: { unranked: false } });
    expect(
      (await getJson<AttentionBody>(`${base}/api/attention`)).items.some(
        (i) => i.source === "unranked"
      )
    ).toBe(false);
  });
});

describe("the knobs behind the grid", () => {
  test("the quiet threshold is the user's, not a constant", async () => {
    // serves is written into the record rather than posted, because setServes
    // bumps `updated` — which is the very thing "gone quiet" measures.
    const dir = resolve(controlRoomHome(), "memory", "projects", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: demo\nstatus: active\ncreated: 2026-08-01T00:00:00.000Z\nupdated: 2026-08-25T00:00:00.000Z\nserves: goal\nserves_by: user\npath: ${controlRoomHome()}\n---\n\n## Goal\n\nnone\n`,
      "utf-8"
    );
    const base = await listen();

    const quietAt = async () => {
      const grid = await getJson<Matrix>(`${base}/api/matrix`);
      return (
        [...grid.now, ...grid.plan].find((i) => i.id === "demo")?.urgentBecause ?? []
      );
    };

    await post(base, "/api/prefs", { quietAfterDays: 365 });
    expect(await quietAt()).not.toContain("gone quiet");

    await post(base, "/api/prefs", { quietAfterDays: 1 });
    expect(await quietAt()).toContain("gone quiet");
  });

  test("goals leave the grid when they are switched off", async () => {
    const base = await listen();
    await post(base, "/api/prefs", { rankGoals: false });
    const grid = await getJson<Matrix>(`${base}/api/matrix`);
    const all = [...grid.now, ...grid.plan, ...grid.noise, ...grid.later];
    expect(all.some((i) => i.kind === "goal")).toBe(false);
  });

  test("a threshold outside its range is refused", async () => {
    const base = await listen();
    expect((await post(base, "/api/prefs", { quietAfterDays: 0 })).status).toBe(400);
    expect((await post(base, "/api/prefs", { rankGoals: "yes" })).status).toBe(400);
    expect(
      (await post(base, "/api/prefs", { attention: { nonsense: true } })).status
    ).toBe(400);
  });
});

describe("keeping PAL up to date", () => {
  test("the page reads the toggle and the installed version", async () => {
    const base = await listen();
    const status = await getJson<AutoUpdateStatus>(`${base}/api/update`);
    expect(status.enabled).toBe(false);
    expect(status.current).toBeTruthy();
  });

  test("the switch turns daily updates on, and off again", async () => {
    const base = await listen();

    expect((await post(base, "/api/update", { enabled: true })).status).toBe(200);
    expect((await getJson<AutoUpdateStatus>(`${base}/api/update`)).enabled).toBe(true);

    await post(base, "/api/update", { enabled: false });
    expect((await getJson<AutoUpdateStatus>(`${base}/api/update`)).enabled).toBe(false);
  });

  test("flipping the switch also settles the question install asks", async () => {
    const base = await listen();
    await post(base, "/api/update", { enabled: true });
    expect((await getJson<AutoUpdateStatus>(`${base}/api/update`)).decided).toBe(true);
  });

  test("anything but true or false is refused", async () => {
    const base = await listen();
    expect((await post(base, "/api/update", { enabled: "yes" })).status).toBe(400);
    expect((await post(base, "/api/update", {})).status).toBe(400);
  });
});

describe("snoozing a criterion", () => {
  test("a snoozed ISC stops counting as open, and waking it restores the count", async () => {
    registerProject("demo", "## Criteria\n\n- [ ] ISC-1: one\n- [ ] ISC-2: two\n");
    const base = await listen();
    const openCount = async () =>
      (await getJson<ProjectCard[]>(`${base}/api/board`))[0].openIscs;

    expect(await openCount()).toBe(2);

    await post(base, "/api/snooze", { project: "demo", id: 1, days: 7 });
    expect(await openCount()).toBe(1);

    const detail = await getJson<{ iscs: { id: number; snoozedUntil: string | null }[] }>(
      `${base}/api/project?slug=demo`
    );
    expect(detail.iscs.find((i) => i.id === 1)?.snoozedUntil).toBeTruthy();

    await post(base, "/api/snooze", { project: "demo", id: 1, days: 0 });
    expect(await openCount()).toBe(2);
  });

  test("a snooze longer than the cap is refused", async () => {
    registerProject("demo", "## Criteria\n\n- [ ] ISC-1: one\n");
    const base = await listen();
    expect(
      (await post(base, "/api/snooze", { project: "demo", id: 1, days: 400 })).status
    ).toBe(400);
    expect(
      (await post(base, "/api/snooze", { project: "demo", id: 1, days: -1 })).status
    ).toBe(400);
  });
});

describe("how the page itself is served", () => {
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

describe("the relationship tab", () => {
  const draftRule = async () => {
    const { addDraft } = await import("../src/hooks/lib/adaptation-rules");
    return addDraft({
      when: "Claiming tests pass",
      trigger: { side: "reply", pattern: "tests? pass" },
      steering: "Show the test output.",
      evidence: [],
    });
  };

  test("/api/relationship lists the drafts waiting", async () => {
    const draft = await draftRule();
    const base = await listen();
    const body = await getJson<{ drafts: { id: string }[] }>(`${base}/api/relationship`);
    expect(body.drafts.map((d) => d.id)).toEqual([draft.id]);
  });

  test("/api/relationship says why a gated draft is not offered as an opinion", async () => {
    const { addDraft } = await import("../src/hooks/lib/adaptation-rules");
    const open = await draftRule();
    const gated = addDraft({
      when: "Claiming CI is green",
      trigger: { side: "reply", pattern: "ci is green" },
      steering: "Link the run.",
      kind: "unverified-claim",
      evidence: [],
      opinionGate: { corrections: 2 },
    });
    const base = await listen();
    const body = await getJson<{ drafts: { id: string; gateAdvice?: string }[] }>(
      `${base}/api/relationship`
    );
    expect(body.drafts).toMatchObject([
      { id: open.id },
      {
        id: gated.id,
        gateAdvice: "2 corrections of its kind so far; an opinion needs 5",
      },
    ]);
    expect(body.drafts[0].gateAdvice).toBeUndefined();
  });

  test("approving from the page decides the draft, and a second decision is refused", async () => {
    const draft = await draftRule();
    const base = await listen();

    const first = await post(base, "/api/rule", { id: draft.id, decision: "approved" });
    expect(first.status).toBe(200);
    const second = await post(base, "/api/rule", { id: draft.id, decision: "denied" });
    expect(second.status).toBe(409);
  });

  test("a rule write keeps an opinion and retires it", async () => {
    const draft = await draftRule();
    const base = await listen();

    const kept = await post(base, "/api/rule", { id: draft.id, decision: "opinion" });
    expect(kept.status).toBe(409);
    expect(await kept.json()).toMatchObject({
      error: `Rule ${draft.id} has no correction kind, so its effect could not be measured`,
    });
    await post(base, "/api/rule", { id: draft.id, decision: "approved" });
    const retired = await post(base, "/api/rule", { id: draft.id, decision: "retired" });
    expect(retired.status).toBe(200);
    expect(await retired.json()).toEqual({
      id: draft.id,
      decision: "retired",
      changed: true,
    });
  });

  test("a rule write names the decisions it takes", async () => {
    const base = await listen();
    const refused = await post(base, "/api/rule", { id: "x", decision: "maybe" });
    expect(await refused.json()).toEqual({
      error: "decision must be one of approved, denied, opinion, retired",
    });
  });

  test("a rule write refuses what it cannot act on", async () => {
    const base = await listen();
    expect((await post(base, "/api/rule", { id: "x", decision: "maybe" })).status).toBe(
      400
    );
    expect((await post(base, "/api/rule", { decision: "approved" })).status).toBe(400);
    expect((await post(base, "/api/rule", { id: "x", decision: "denied" })).status).toBe(
      404
    );
  });

  test("a waiting draft lights the bell and links to the tab", async () => {
    const draft = await draftRule();
    const base = await listen();
    const body = await getJson<AttentionBody>(`${base}/api/attention`);
    expect(body.items.find((i) => i.source === "rules")).toMatchObject({
      id: `rule:${draft.id}`,
      href: "/relationship",
    });
  });

  test("a decided rule leaves the bell", async () => {
    const draft = await draftRule();
    const base = await listen();
    await post(base, "/api/rule", { id: draft.id, decision: "denied" });
    const body = await getJson<AttentionBody>(`${base}/api/attention`);
    expect(body.items.filter((i) => i.source === "rules")).toEqual([]);
  });

  test("the bell stays quiet about drafts when the rules source is off", async () => {
    await draftRule();
    const base = await listen();
    await post(base, "/api/prefs", { attention: { rules: false } });
    const body = await getJson<AttentionBody>(`${base}/api/attention`);
    expect(body.items.filter((i) => i.source === "rules")).toEqual([]);
  });
});
