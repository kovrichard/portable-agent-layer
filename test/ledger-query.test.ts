import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The read side is only worth as much as the questions it can answer without
// lying. These cases are about the three ways it could: losing the rotated
// history, missing entries whose target is spelled the other way, and calling a
// change "empty" when it was withheld or too large to keep.

let HOME: string;
let PROJECT: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-ledger-query-"));
  PROJECT = mkdtempSync(resolve(tmpdir(), "pal-project-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "ledger"), { recursive: true });
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PROJECT, { recursive: true, force: true });
});

async function query() {
  return await import("../src/tools/ledger/query");
}

function registerProject(slug: string, path: string): void {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ISA.md"),
    `---\nname: ${slug}\nstatus: active\ncreated: 2026-09-01T00:00:00.000Z\nupdated: 2026-09-01T00:00:00.000Z\npath: ${path}\n---\n\n## Goal\n\nnone\n`,
    "utf-8"
  );
}

type EntryOverrides = Record<string, unknown>;

let serial = 0;

function entry(overrides: EntryOverrides = {}): Record<string, unknown> {
  serial++;
  return {
    id: `id-${serial}`,
    ts: "2026-09-04T12:00:00.000Z",
    machine: "machine-a",
    actor: "actor-a",
    runtime: "claude",
    authority: "user",
    tool: "Edit",
    target: "{proj:demo}/src/a.ts",
    outcome: "applied",
    before: { hash: "before-hash", bytes: 10 },
    after: { hash: "after-hash", bytes: 12 },
    delta: { hunks: [{ at: 0, remove: 1, insert: ["new"] }] },
    ...overrides,
  };
}

function writeLedger(name: string, rows: Record<string, unknown>[]): void {
  writeFileSync(
    resolve(HOME, "memory", "ledger", name),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf-8"
  );
}

describe("history that rotation moved aside", () => {
  test("an archived entry is still found", async () => {
    writeLedger("actions-2026-09-01T00-00-00-000Z.jsonl", [entry({ id: "old" })]);
    writeLedger("actions.jsonl", [entry({ id: "current" })]);

    const ids = (await query()).readLedger().map((e) => e.id);
    expect(ids).toEqual(["old", "current"]);
  });

  test("archives are read oldest first, so the log reads in order", async () => {
    writeLedger("actions-2026-09-02T00-00-00-000Z.jsonl", [entry({ id: "second" })]);
    writeLedger("actions-2026-09-01T00-00-00-000Z.jsonl", [entry({ id: "first" })]);

    expect((await query()).readLedger().map((e) => e.id)).toEqual(["first", "second"]);
  });

  test("a half-written line is skipped rather than failing the query", async () => {
    writeFileSync(
      resolve(HOME, "memory", "ledger", "actions.jsonl"),
      `${JSON.stringify(entry({ id: "good" }))}\n{"id":"trunc`,
      "utf-8"
    );
    expect((await query()).readLedger().map((e) => e.id)).toEqual(["good"]);
  });

  test("no ledger at all is an empty result, not a throw", async () => {
    expect((await query()).readLedger()).toEqual([]);
  });
});

describe("naming a project two different ways", () => {
  test("an anchored target matches its slug", async () => {
    writeLedger("actions.jsonl", [entry({ id: "anchored" })]);
    registerProject("demo", PROJECT);

    const hits = (await query()).queryLedger({ project: "demo" });
    expect(hits.map((e) => e.id)).toEqual(["anchored"]);
  });

  /** Entries written before anchoring shipped carry an absolute path instead. */
  test("a plain absolute path inside the project matches too", async () => {
    writeLedger("actions.jsonl", [
      entry({ id: "plain", target: resolve(PROJECT, "src", "b.ts") }),
    ]);
    registerProject("demo", PROJECT);

    expect((await query()).queryLedger({ project: "demo" }).map((e) => e.id)).toEqual([
      "plain",
    ]);
  });

  test("a path outside the project does not match it", async () => {
    writeLedger("actions.jsonl", [
      entry({ id: "elsewhere", target: "/somewhere/else.ts" }),
    ]);
    registerProject("demo", PROJECT);

    expect((await query()).queryLedger({ project: "demo" })).toEqual([]);
  });

  test("another project's anchor does not match", async () => {
    writeLedger("actions.jsonl", [
      entry({ id: "other", target: "{proj:other}/src/a.ts" }),
    ]);
    registerProject("demo", PROJECT);

    expect((await query()).queryLedger({ project: "demo" })).toEqual([]);
  });
});

describe("filters", () => {
  beforeEach(() => {
    writeLedger("actions.jsonl", [
      entry({
        id: "a",
        ts: "2026-09-01T00:00:00.000Z",
        outcome: "applied",
        tool: "Edit",
      }),
      entry({
        id: "b",
        ts: "2026-09-03T00:00:00.000Z",
        outcome: "denied",
        tool: "Write",
        runtime: "cursor",
        actor: "actor-b",
        machine: "machine-b",
        after: null,
        delta: undefined,
      }),
      entry({
        id: "c",
        ts: "2026-09-05T00:00:00.000Z",
        target: "{proj:demo}/memory/x.md",
      }),
    ]);
  });

  test("a window keeps only what falls inside it", async () => {
    const hits = (await query()).queryLedger({
      since: new Date("2026-09-02T00:00:00.000Z"),
      until: new Date("2026-09-04T00:00:00.000Z"),
    });
    expect(hits.map((e) => e.id)).toEqual(["b"]);
  });

  test("filters compose rather than replacing one another", async () => {
    const hits = (await query()).queryLedger({ outcome: "applied", tool: "Edit" });
    expect(hits.map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("a target substring answers which actions touched shared memory", async () => {
    expect((await query()).queryLedger({ target: "memory/" }).map((e) => e.id)).toEqual([
      "c",
    ]);
  });

  test("actor and machine separate one install's actions from another's", async () => {
    expect(
      (await query()).queryLedger({ machine: "machine-b" }).map((e) => e.id)
    ).toEqual(["b"]);
    expect((await query()).queryLedger({ actor: "actor-b" }).map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  test("a limit keeps the newest, not the first", async () => {
    expect((await query()).queryLedger({ limit: 1 }).map((e) => e.id)).toEqual(["c"]);
  });

  test("no filter returns everything", async () => {
    expect((await query()).queryLedger()).toHaveLength(3);
  });
});

describe("a window asked for the way someone says it", () => {
  const NOW = new Date("2026-09-10T00:00:00.000Z");

  test("a duration counts back from now", async () => {
    const since = (await query()).parseSince("7d", NOW);
    expect(since?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  test("hours and weeks are understood too", async () => {
    expect((await query()).parseSince("24h", NOW)?.toISOString()).toBe(
      "2026-09-09T00:00:00.000Z"
    );
    expect((await query()).parseSince("1w", NOW)?.toISOString()).toBe(
      "2026-09-03T00:00:00.000Z"
    );
  });

  test("a calendar date is taken as given", async () => {
    expect((await query()).parseSince("2026-09-01", NOW)?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });

  /** Silently ignoring it would answer a narrow question with the whole ledger. */
  test("nonsense is rejected instead of ignored", async () => {
    expect((await query()).parseSince("last tuesday", NOW)).toBeNull();
    expect((await query()).parseSince("7q", NOW)).toBeNull();
  });
});

describe("what an entry can say about its own change", () => {
  test("hunks are reported as hunks", async () => {
    writeLedger("actions.jsonl", [entry()]);
    const [only] = (await query()).queryLedger();
    expect((await query()).changeShape(only).kind).toBe("hunks");
  });

  test("a withheld change is not an empty one", async () => {
    writeLedger("actions.jsonl", [entry({ delta: { hunks: [], redacted: true } })]);
    const [only] = (await query()).queryLedger();
    expect((await query()).changeShape(only).kind).toBe("redacted");
  });

  test("a change too large to keep is not an empty one either", async () => {
    writeLedger("actions.jsonl", [entry({ delta: { hunks: [], truncated: true } })]);
    const [only] = (await query()).queryLedger();
    expect((await query()).changeShape(only).kind).toBe("truncated");
  });

  test("an action that never landed recorded no change", async () => {
    writeLedger("actions.jsonl", [
      entry({ outcome: "denied", after: null, delta: undefined }),
    ]);
    const [only] = (await query()).queryLedger();
    expect((await query()).changeShape(only).kind).toBe("none");
  });
});

describe("whether a recorded change is still the state of the file", () => {
  const AFTER = "one\ntwo\n";
  const BEFORE = "one\n";

  function hash(content: string): string {
    return new Bun.CryptoHasher("sha256").update(content, "utf-8").digest("hex");
  }

  function edit(overrides: EntryOverrides = {}): Record<string, unknown> {
    return entry({
      target: "{proj:demo}/f.txt",
      before: { hash: hash(BEFORE), bytes: BEFORE.length },
      after: { hash: hash(AFTER), bytes: AFTER.length },
      delta: { hunks: [{ at: 1, remove: 0, insert: ["two"] }] },
      ...overrides,
    });
  }

  function onDisk(content: string): void {
    writeFileSync(resolve(PROJECT, "f.txt"), content, "utf-8");
  }

  beforeEach(() => {
    registerProject("demo", PROJECT);
  });

  test("a file still matching the after-hash is in place", async () => {
    writeLedger("actions.jsonl", [edit()]);
    onDisk(AFTER);
    const [only] = (await query()).queryLedger();
    expect((await query()).standing(only).state).toBe("in-place");
  });

  /** Back at its before-state is the one case the stored delta can be run forward. */
  test("a file back at its before-hash reads as reverted, and the delta replays", async () => {
    writeLedger("actions.jsonl", [edit()]);
    onDisk(BEFORE);
    const [only] = (await query()).queryLedger();
    expect((await query()).standing(only)).toEqual({ state: "reverted", replays: true });
  });

  test("a file that moved on again is superseded, not a mismatch", async () => {
    writeLedger("actions.jsonl", [edit()]);
    onDisk("something else entirely\n");
    const [only] = (await query()).queryLedger();
    expect((await query()).standing(only).state).toBe("superseded");
  });

  test("a deleted target is reported as gone", async () => {
    writeLedger("actions.jsonl", [edit()]);
    const [only] = (await query()).queryLedger();
    expect((await query()).standing(only).state).toBe("missing");
  });

  test("an action that never landed has no standing to check", async () => {
    writeLedger("actions.jsonl", [
      edit({ outcome: "denied", after: null, delta: undefined }),
    ]);
    const [only] = (await query()).queryLedger();
    expect((await query()).standing(only).state).toBe("unknown");
  });

  test("a project this install never registered is unknown, not missing", async () => {
    writeLedger("actions.jsonl", [edit({ target: "{proj:never-seen}/f.txt" })]);
    const [only] = (await query()).queryLedger();
    const verdict = (await query()).standing(only);
    expect(verdict.state).toBe("unknown");
    expect(verdict).toHaveProperty("why", "unknown project never-seen");
  });
});

describe("what the record says became of a change", () => {
  const A = "hash-a";
  const B = "hash-b";
  const C = "hash-c";

  function link(id: string, before: string | null, after: string | null): EntryOverrides {
    return {
      id,
      before: before === null ? null : { hash: before, bytes: 1 },
      after: after === null ? null : { hash: after, bytes: 1 },
    };
  }

  async function verdictFor(id: string) {
    const q = await query();
    const found = q.findEntry(id);
    if (!found) throw new Error(`no entry ${id}`);
    return q.chainVerdict(found);
  }

  test("the newest action on a target is the latest", async () => {
    writeLedger("actions.jsonl", [entry(link("only", A, B))]);
    expect(await verdictFor("only")).toEqual({ state: "latest" });
  });

  test("a later action restoring the before-state is named as the undo", async () => {
    writeLedger("actions.jsonl", [
      entry(link("first", A, B)),
      entry({ ...link("undo", B, A), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    expect(await verdictFor("first")).toEqual({
      state: "undone",
      by: "undo",
      at: "2026-09-04T13:00:00.000Z",
    });
  });

  test("a later action that changed it again is followed, not undone", async () => {
    writeLedger("actions.jsonl", [
      entry(link("first", A, B)),
      entry({ ...link("onward", B, C), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    expect(await verdictFor("first")).toEqual({
      state: "followed",
      by: "onward",
      at: "2026-09-04T13:00:00.000Z",
    });
  });

  /** Naming a later undo would date the revert to the wrong action. */
  test("the first undo is named, not a later one", async () => {
    writeLedger("actions.jsonl", [
      entry(link("first", A, B)),
      entry({ ...link("undo", B, A), ts: "2026-09-04T13:00:00.000Z" }),
      entry({ ...link("again", A, B), ts: "2026-09-04T14:00:00.000Z" }),
      entry({ ...link("undo2", B, A), ts: "2026-09-04T15:00:00.000Z" }),
    ]);
    expect(await verdictFor("first")).toMatchObject({ state: "undone", by: "undo" });
  });

  test("another target's actions are not part of this chain", async () => {
    writeLedger("actions.jsonl", [
      entry(link("first", A, B)),
      entry({
        ...link("elsewhere", B, A),
        target: "{proj:demo}/other.ts",
        ts: "2026-09-04T13:00:00.000Z",
      }),
    ]);
    expect(await verdictFor("first")).toEqual({ state: "latest" });
  });

  /**
   * The later action lands on the refused one's before-hash, which is what an
   * undo looks like — but a refused action changed nothing, so there was
   * nothing for it to undo.
   */
  test("an action that never landed has nothing to undo", async () => {
    writeLedger("actions.jsonl", [
      entry({ ...link("denied", A, null), outcome: "denied", delta: undefined }),
      entry({ ...link("next", B, A), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    expect(await verdictFor("denied")).toMatchObject({ state: "followed", by: "next" });
  });

  test("a file creation is not undone by a later write", async () => {
    writeLedger("actions.jsonl", [
      entry({ ...link("created", null, B), tool: "Write" }),
      entry({ ...link("after", B, C), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    expect(await verdictFor("created")).toMatchObject({ state: "followed" });
  });

  /** Independence from disk is the whole point: it stays true after the file moves on. */
  test("the verdict holds with no file on disk at all", async () => {
    writeLedger("actions.jsonl", [
      entry(link("first", A, B)),
      entry({ ...link("undo", B, A), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    registerProject("demo", PROJECT);

    const q = await query();
    const found = q.findEntry("first");
    if (!found) throw new Error("missing");
    expect(q.standing(found).state).toBe("missing");
    expect(q.chainVerdict(found)).toMatchObject({ state: "undone", by: "undo" });
  });

  /** The chain must span the whole ledger, not whatever a filter left behind. */
  test("an undo living in a rotated archive is still found", async () => {
    writeLedger("actions-2026-09-01T00-00-00-000Z.jsonl", [
      entry(link("archived", A, B)),
    ]);
    writeLedger("actions.jsonl", [
      entry({ ...link("undo", B, A), ts: "2026-09-04T13:00:00.000Z" }),
    ]);
    expect(await verdictFor("archived")).toMatchObject({ state: "undone", by: "undo" });
  });
});

describe("counts over a set of actions", () => {
  test("groups by every dimension the ledger records", async () => {
    writeLedger("actions.jsonl", [
      entry({ outcome: "applied", runtime: "claude", tool: "Edit" }),
      entry({ outcome: "denied", runtime: "cursor", tool: "Write", after: null }),
      entry({ outcome: "applied", runtime: "claude", tool: "Edit" }),
    ]);

    const q = await query();
    const stats = q.summarize(q.queryLedger());
    expect(stats.total).toBe(3);
    expect(stats.byOutcome).toEqual({ applied: 2, denied: 1 });
    expect(stats.byRuntime).toEqual({ claude: 2, cursor: 1 });
    expect(stats.byTool).toEqual({ Edit: 2, Write: 1 });
    expect(stats.topTargets[0]).toEqual({ target: "{proj:demo}/src/a.ts", count: 3 });
  });

  test("an empty set has no span to report", async () => {
    const q = await query();
    expect(q.summarize([]).span).toBeNull();
  });
});
