import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  agentsAtWork,
  askingReasons,
  badgeFromNudge,
  board,
  dueBadges,
  firstSentence,
  handoffSentence,
  handoffs,
  type ProjectCard,
  ratingSeries,
  sortBoard,
} from "../src/tools/control-room/data";

// Every number the page shows comes from one of these functions, so each one
// is pinned against a fixture home rather than against the live ~/.pal.

const NOW = new Date("2026-09-05T12:00:00.000Z");
let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-control-room-data-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function projectDir(slug: string): string {
  const dir = resolve(HOME, "memory", "projects", slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function registerProject(
  slug: string,
  opts: {
    updated?: string;
    status?: string;
    frontmatter?: string;
    criteria?: string;
  } = {}
): string {
  const path = resolve(HOME, "work", slug);
  mkdirSync(path, { recursive: true });
  const front = [
    `name: ${slug}`,
    `status: ${opts.status ?? "active"}`,
    "created: 2026-08-01T00:00:00.000Z",
    `updated: ${opts.updated ?? "2026-09-04T00:00:00.000Z"}`,
    `path: ${path}`,
    opts.frontmatter ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(
    resolve(projectDir(slug), "ISA.md"),
    `---\n${front}\n---\n\n## Goal\n\nnone\n\n## Criteria\n\n${opts.criteria ?? ""}\n`,
    "utf-8"
  );
  return path;
}

function writeHistory(slug: string, dates: string[]): void {
  writeFileSync(
    resolve(projectDir(slug), "history.jsonl"),
    `${dates.map((date) => JSON.stringify({ date, title: `t ${date}`, summary: "", insights: "" })).join("\n")}\n`,
    "utf-8"
  );
}

function writeHandoffs(entries: Record<string, Record<string, unknown>>): void {
  const dir = resolve(HOME, "memory", "state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "last-handoff.json"), JSON.stringify(entries), "utf-8");
}

function handoffEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: "2026-09-04T18:00:00.000Z",
    title: "the title",
    status: "in-progress",
    handoff: "Finish the thing. Then start the other thing.",
    artifacts: [],
    source: "deliberate",
    ...overrides,
  };
}

function card(overrides: Partial<ProjectCard>): ProjectCard {
  return {
    slug: "x",
    path: null,
    status: "active",
    updated: "2026-09-01T00:00:00.000Z",
    ageDays: 4,
    stale: false,
    openIscs: 0,
    next: [],
    blockers: [],
    lastSession: null,
    sessions30d: 0,
    asking: [],
    serves: null,
    servesBy: null,
    runtimes: {},
    ...overrides,
  };
}

describe("board", () => {
  test("counts only the open criteria", () => {
    registerProject("demo", {
      criteria:
        "- [ ] ISC-1: open one\n- [x] ISC-2: done\n- [~] ISC-3: partial\n- [ ] ISC-4: open two",
    });
    expect(board(NOW)[0].openIscs).toBe(2);
  });

  test("carries next, blockers, staleness and the last session", () => {
    registerProject("demo", {
      updated: "2026-08-01T00:00:00.000Z",
      frontmatter: 'next: ["ship it"]\nblockers: ["waiting on a key"]',
    });
    writeHistory("demo", ["2026-08-02", "2026-08-30"]);
    const [c] = board(NOW);
    expect(c.next).toEqual(["ship it"]);
    expect(c.blockers).toEqual(["waiting on a key"]);
    expect(c.stale).toBe(true);
    expect(c.ageDays).toBe(35);
    expect(c.lastSession).toEqual({ date: "2026-08-30", title: "t 2026-08-30" });
    expect(c.sessions30d).toBe(1);
  });

  test("a fresh in-progress handoff on the project's path is a reason", () => {
    const path = registerProject("demo");
    writeHandoffs({ [path]: handoffEntry() });
    expect(board(NOW)[0].asking).toEqual(["handoff in progress"]);
  });

  test("asking reasons: handoff, blockers, quiet while active", () => {
    const base = { name: "p", status: "active", created: "", updated: "" } as const;
    expect(askingReasons({ ...base }, undefined, false)).toEqual([]);
    expect(askingReasons({ ...base, blockers: ["a"] }, undefined, false)).toEqual([
      "1 blocker",
    ]);
    expect(askingReasons({ ...base, blockers: ["a", "b"] }, undefined, true)).toEqual([
      "2 blockers",
      "gone quiet",
    ]);
    expect(askingReasons({ ...base, status: "paused" }, undefined, true)).toEqual([]);
  });

  test("sorts the projects asking for you first, then by recency", () => {
    const sorted = sortBoard([
      card({ slug: "old-quiet", updated: "2026-08-01" }),
      card({ slug: "new-quiet", updated: "2026-09-04" }),
      card({ slug: "asking", updated: "2026-07-01", asking: ["1 blocker"] }),
    ]);
    expect(sorted.map((c) => c.slug)).toEqual(["asking", "new-quiet", "old-quiet"]);
  });
});

describe("handoffs", () => {
  test("first sentence, whitespace collapsed", () => {
    expect(firstSentence("Finish   the thing.\nThen more.")).toBe("Finish the thing.");
    expect(firstSentence("v0.70.0 is out. Next?")).toBe("v0.70.0 is out.");
    expect(firstSentence("no terminator here")).toBe("no terminator here");
  });

  test("an automatic handoff is reduced to the user's own last words", () => {
    expect(
      handoffSentence(
        "Last user message: do you think Misfire is a better name? Maybe not. Last assistant response: ══════ PAL | NATIVE ══════"
      )
    ).toBe("do you think Misfire is a better name?");
    expect(
      handoffSentence("Last user message: log this pls Last assistant response: done.")
    ).toBe("log this pls");
    expect(handoffSentence("Finish the thing. Then more.")).toBe("Finish the thing.");
  });

  test("in-progress and fresh only, mapped to the project by path, newest first", () => {
    const demo = registerProject("demo");
    writeHandoffs({
      [demo]: handoffEntry({ timestamp: "2026-09-03T00:00:00.000Z" }),
      "/elsewhere/unregistered": handoffEntry({ timestamp: "2026-09-04T00:00:00.000Z" }),
      "/elsewhere/done": handoffEntry({ status: "completed" }),
      "/elsewhere/old": handoffEntry({ timestamp: "2026-08-01T00:00:00.000Z" }),
    });
    const cards = handoffs(NOW);
    expect(cards.map((h) => [h.slug, h.label, h.ageDays])).toEqual([
      [null, "unregistered", 1],
      ["demo", "demo", 2],
    ]);
    expect(cards[1].sentence).toBe("Finish the thing.");
  });
});

describe("signal", () => {
  test("a silent nudge is a clear badge; a spoken one is due, minus its heading and emoji", () => {
    expect(badgeFromNudge("")).toEqual({ state: "clear", detail: "" });
    expect(badgeFromNudge("## Learning Analysis Due\n📊 Never run — offer it.")).toEqual({
      state: "due",
      detail: "Never run — offer it.",
    });
  });

  test("the algorithm-review badge is not applicable outside a maintainer checkout", () => {
    const due = dueBadges(NOW, false);
    expect(due.algorithmReview.state).toBe("n/a");
    expect(due.analysis.state).toBe("due");
    expect(due.relationshipReflect.state).toBe("clear");
  });

  test("the rating series is the tail of ratings.jsonl, bad lines skipped", () => {
    const dir = resolve(HOME, "memory", "signals");
    mkdirSync(dir, { recursive: true });
    const rows = Array.from({ length: 70 }, (_, i) =>
      JSON.stringify({
        ts: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        rating: (i % 10) + 1,
      })
    );
    rows.splice(10, 0, "not json", JSON.stringify({ ts: "x", note: "no rating" }));
    writeFileSync(resolve(dir, "ratings.jsonl"), `${rows.join("\n")}\n`, "utf-8");
    const series = ratingSeries();
    expect(series).toHaveLength(60);
    expect(series.at(-1)?.rating).toBe(10);
    expect(ratingSeries(3).map((p) => p.rating)).toEqual([8, 9, 10]);
  });
});

describe("agents at work", () => {
  test("groups the window's ledger by project with distinct machines and actors", () => {
    const demo = registerProject("demo");
    writeHistory("demo", ["2026-08-01", "2026-09-02", "2026-09-04"]);
    const dir = resolve(HOME, "memory", "ledger");
    mkdirSync(dir, { recursive: true });
    const rows = [
      { target: "{proj:demo}/a", runtime: "claude", machine: "m1", actor: "a1" },
      { target: "{proj:demo}/b", runtime: "claude", machine: "m2", actor: "a1" },
      { target: "{proj:demo}/c", runtime: "cursor", machine: "m1", actor: "a1" },
      { target: "{proj:other}/d", runtime: "codex", machine: "m1", actor: "a1" },
      {
        target: "{proj:demo}/z",
        runtime: "claude",
        machine: "m1",
        actor: "a1",
        ts: "2026-08-01T00:00:00.000Z",
      },
    ].map((r, i) => ({
      id: `id-${i}`,
      ts: "2026-09-04T00:00:00.000Z",
      authority: "user",
      tool: "Edit",
      outcome: "applied",
      before: null,
      after: { hash: "a", bytes: 1 },
      ...r,
    }));
    writeFileSync(
      resolve(dir, "actions.jsonl"),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
      "utf-8"
    );
    const view = agentsAtWork({ since: new Date("2026-09-01T00:00:00.000Z") }, NOW);
    expect(view.since).toBe("2026-09-01T00:00:00.000Z");
    expect(view.projects).toEqual([
      {
        slug: "demo",
        actions: 3,
        runtimes: { claude: 2, cursor: 1 },
        machines: 2,
        actors: 1,
        sessions: 2,
      },
      {
        slug: "other",
        actions: 1,
        runtimes: { codex: 1 },
        machines: 1,
        actors: 1,
        sessions: 0,
      },
    ]);
    expect(demo).toContain("demo");
  });
});
