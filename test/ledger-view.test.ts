import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The page shows numbers and words, not records. These cases pin the words:
// which outcomes count as refusals, whose name appears on a row, how an anchor
// reads, and what a refused action says in the change column.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-ledger-view-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "ledger"), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function view() {
  return await import("../src/tools/ledger/view");
}

let serial = 0;

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  serial++;
  return {
    id: `id-${serial}`,
    ts: `2026-09-04T12:00:${String(serial % 60).padStart(2, "0")}.000Z`,
    machine: "machine-a",
    actor: "actor-a",
    runtime: "claude",
    authority: "user",
    tool: "Edit",
    target: "{proj:demo}/src/a.ts",
    outcome: "applied",
    before: { hash: "before-hash", bytes: 10 },
    after: { hash: "after-hash", bytes: 12 },
    delta: { hunks: [{ at: 0, remove: 1, insert: ["new", "newer"] }] },
    ...overrides,
  };
}

function refused(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return entry({
    outcome: "denied",
    after: null,
    delta: undefined,
    reason: "the user said no",
    ...overrides,
  });
}

function writeLedger(rows: Record<string, unknown>[]): void {
  writeFileSync(
    resolve(HOME, "memory", "ledger", "actions.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf-8"
  );
}

function nameLocalActor(id: string, label: string): void {
  writeFileSync(
    resolve(HOME, "memory", "actor.json"),
    JSON.stringify({ id, label, createdAt: "2026-09-01T00:00:00.000Z" }),
    "utf-8"
  );
}

describe("the four numbers", () => {
  test("each outcome is split by authority and by runtime", async () => {
    writeLedger([
      entry({ authority: "user", runtime: "claude" }),
      entry({ authority: "agent", runtime: "claude" }),
      entry({ authority: "user", runtime: "cursor" }),
      entry({ outcome: "failed", authority: "user", runtime: "codex" }),
      refused({ authority: "user", runtime: "claude" }),
    ]);

    const { stats } = (await view()).ledgerView();
    expect(stats.outcomes.applied).toEqual({
      total: 3,
      byAuthority: { user: 2, agent: 1 },
      byRuntime: { claude: 2, cursor: 1 },
    });
    expect(stats.outcomes.failed).toEqual({
      total: 1,
      byAuthority: { user: 1 },
      byRuntime: { codex: 1 },
    });
    expect(stats.outcomes.denied.total).toBe(1);
    expect(stats.outcomes.blocked.total).toBe(0);
  });

  test("refusals are denied plus blocked", async () => {
    writeLedger([entry(), refused(), refused({ outcome: "blocked" }), refused()]);

    const { stats } = (await view()).ledgerView();
    expect(stats.refusals).toBe(3);
    expect(stats.total).toBe(4);
  });

  test("an outcome the page does not know is counted in the total only", async () => {
    writeLedger([entry({ outcome: "mystery" })]);

    const { stats } = (await view()).ledgerView();
    expect(stats.total).toBe(1);
    expect(stats.outcomes.applied.total).toBe(0);
  });

  test("an empty ledger is four zeros, not a throw", async () => {
    const { stats, rows } = (await view()).ledgerView();
    expect(stats.total).toBe(0);
    expect(stats.refusals).toBe(0);
    expect(rows).toEqual([]);
  });
});

describe("the rows", () => {
  test("newest first, the way the mock's log reads", async () => {
    writeLedger([entry({ id: "older" }), entry({ id: "newer" })]);

    const ids = (await view()).ledgerView().rows.map((r) => r.id);
    expect(ids).toEqual(["newer", "older"]);
  });

  test("a known actor appears by label, an unknown one by short id", async () => {
    nameLocalActor("actor-a", "Ada");
    writeLedger([entry({ actor: "actor-a" }), entry({ actor: "actor-nobody-knows" })]);

    const rows = (await view()).ledgerView().rows;
    expect(rows[1].actor).toBe("Ada");
    expect(rows[0].actor).not.toBe("actor-nobody-knows");
    expect(rows[0].actor.length).toBeLessThan("actor-nobody-knows".length);
  });

  test("an applied row carries its line counts", async () => {
    writeLedger([entry()]);

    const [row] = (await view()).ledgerView().rows;
    expect(row.change).toBe("+2 -1");
    expect(row.reason).toBeUndefined();
  });

  test("a refused row carries the reason and no change", async () => {
    writeLedger([refused()]);

    const [row] = (await view()).ledgerView().rows;
    expect(row.outcome).toBe("denied");
    expect(row.change).toBe("no change");
    expect(row.reason).toBe("the user said no");
  });

  test("a blocked shell row names the command, and only it carries one", async () => {
    writeLedger([entry(), refused({ outcome: "blocked", command: "ls /etc" })]);

    const [blocked, applied] = (await view()).ledgerView().rows;
    expect(blocked.command).toBe("ls /etc");
    // Absent, not undefined: the page tests `r.command` to decide whether to
    // render the second line, and a key set to undefined is still a key.
    expect("command" in applied).toBe(false);
  });

  test("the window is echoed back so the page can say what it shows", async () => {
    const since = new Date("2026-09-01T00:00:00.000Z");
    const { window } = (await view()).ledgerView({ since });
    expect(window).toEqual({ since: since.toISOString(), until: null });
  });
});

describe("how a target reads", () => {
  test("an anchored path becomes project / path", async () => {
    const { displayTarget } = await view();
    expect(displayTarget("{proj:demo}/src/a.ts")).toBe("demo /src/a.ts");
  });

  test("a bare anchor is just the project", async () => {
    const { displayTarget } = await view();
    expect(displayTarget("{proj:demo}")).toBe("demo");
  });

  test("a plain path is left alone", async () => {
    const { displayTarget } = await view();
    expect(displayTarget("/tmp/x.txt")).toBe("/tmp/x.txt");
  });
});
