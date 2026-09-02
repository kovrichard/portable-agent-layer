import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesize, writeSynthesis } from "../src/tools/agent/synthesize";

const HOME = resolve(import.meta.dir, "../.test-home-synthesize");
const savedHome = process.env.PAL_HOME;

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function writeRatings(rows: { ts: string; rating: number }[]) {
  const dir = resolve(HOME, "memory", "signals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "ratings.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`
  );
}

function writeReflections(rows: Record<string, unknown>[]) {
  const dir = resolve(HOME, "memory", "learning", "reflections");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "algorithm-reflections.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`
  );
}

function reflection(over: Record<string, unknown> = {}) {
  return {
    timestamp: iso(1),
    task: "a task",
    criteria_count: 4,
    criteria_passed: 4,
    criteria_failed: 0,
    sentiment: 8,
    q1: "an observation",
    ...over,
  };
}

function writeSession(dateYmd: string, body: string) {
  const year = dateYmd.slice(0, 4);
  const month = dateYmd.slice(4, 6);
  const dir = resolve(HOME, "memory", "learning", "session", year, month);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${dateYmd}-run.md`), body);
}

function ymd(daysAgo = 0): string {
  return iso(daysAgo).slice(0, 10).replace(/-/g, "");
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("synthesize — ratings", () => {
  test("reports zeros and a stable trend with no ratings", () => {
    expect(synthesize(7).ratings).toEqual({
      count: 0,
      avg: 0,
      recentAvg: 0,
      lowCount: 0,
      trend: "stable",
    });
  });

  test("averages the ratings inside the window and rounds to one decimal", () => {
    writeRatings([
      { ts: iso(1), rating: 8 },
      { ts: iso(1), rating: 7 },
      { ts: iso(1), rating: 9 },
    ]);

    const { count, avg } = synthesize(7).ratings;

    expect(count).toBe(3);
    expect(avg).toBe(8);
  });

  test("excludes ratings older than the window", () => {
    writeRatings([
      { ts: iso(1), rating: 8 },
      { ts: iso(40), rating: 1 },
    ]);

    expect(synthesize(7).ratings.count).toBe(1);
  });

  test("counts ratings of 3 or below as low", () => {
    writeRatings([
      { ts: iso(1), rating: 3 },
      { ts: iso(1), rating: 4 },
      { ts: iso(1), rating: 1 },
    ]);

    expect(synthesize(7).ratings.lowCount).toBe(2);
  });

  test("stays stable when there are too few ratings to compare halves", () => {
    writeRatings([
      { ts: iso(1), rating: 1 },
      { ts: iso(1), rating: 10 },
    ]);

    expect(synthesize(7).ratings.trend).toBe("stable");
  });

  test("reports improving when the later half scores higher", () => {
    writeRatings([
      ...Array.from({ length: 4 }, () => ({ ts: iso(2), rating: 4 })),
      ...Array.from({ length: 4 }, () => ({ ts: iso(1), rating: 9 })),
    ]);

    expect(synthesize(7).ratings.trend).toBe("improving");
  });

  test("reports declining when the later half scores lower", () => {
    writeRatings([
      ...Array.from({ length: 4 }, () => ({ ts: iso(2), rating: 9 })),
      ...Array.from({ length: 4 }, () => ({ ts: iso(1), rating: 4 })),
    ]);

    expect(synthesize(7).ratings.trend).toBe("declining");
  });

  test("reports stable when the halves are close", () => {
    writeRatings(Array.from({ length: 8 }, () => ({ ts: iso(1), rating: 7 })));

    expect(synthesize(7).ratings.trend).toBe("stable");
  });

  test("averages only the last ten ratings for the recent figure", () => {
    writeRatings([
      ...Array.from({ length: 10 }, () => ({ ts: iso(2), rating: 2 })),
      ...Array.from({ length: 10 }, () => ({ ts: iso(1), rating: 8 })),
    ]);

    expect(synthesize(7).ratings.recentAvg).toBe(8);
  });
});

describe("synthesize — algorithm reflections", () => {
  test("reports zeros with no reflections", () => {
    expect(synthesize(7).algorithm).toEqual({
      reflectionCount: 0,
      avgSentiment: 0,
      passRate: 0,
      criteriaTotal: 0,
      criteriaPassed: 0,
      recentObservations: [],
    });
  });

  test("sums criteria and derives the pass rate as a percentage", () => {
    writeReflections([
      reflection({ criteria_count: 4, criteria_passed: 4 }),
      reflection({ criteria_count: 6, criteria_passed: 3 }),
    ]);

    const { criteriaTotal, criteriaPassed, passRate } = synthesize(7).algorithm;

    expect(criteriaTotal).toBe(10);
    expect(criteriaPassed).toBe(7);
    expect(passRate).toBe(70);
  });

  test("reports a zero pass rate when no criteria were recorded", () => {
    writeReflections([reflection({ criteria_count: 0, criteria_passed: 0 })]);

    expect(synthesize(7).algorithm.passRate).toBe(0);
  });

  test("rounds average sentiment to one decimal", () => {
    writeReflections([reflection({ sentiment: 8 }), reflection({ sentiment: 9 })]);

    expect(synthesize(7).algorithm.avgSentiment).toBe(8.5);
  });

  test("keeps only the three most recent observations", () => {
    writeReflections([
      reflection({ q1: "first" }),
      reflection({ q1: "second" }),
      reflection({ q1: "third" }),
      reflection({ q1: "fourth" }),
    ]);

    const observations = synthesize(7).algorithm.recentObservations;

    expect(observations.map((o) => o.observation)).toEqual(["second", "third", "fourth"]);
  });

  test("carries the task, cwd and date onto each observation", () => {
    writeReflections([reflection({ task: "the task", cwd: "/somewhere" })]);

    const [observation] = synthesize(7).algorithm.recentObservations;

    expect(observation.task).toBe("the task");
    expect(observation.cwd).toBe("/somewhere");
    expect(observation.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("excludes reflections older than the window", () => {
    writeReflections([
      reflection({ timestamp: iso(1) }),
      reflection({ timestamp: iso(40) }),
    ]);

    expect(synthesize(7).algorithm.reflectionCount).toBe(1);
  });
});

describe("synthesize — sessions", () => {
  test("reports no sessions when the directory is absent", () => {
    const state = synthesize(7);

    expect(state.sessions).toEqual([]);
    expect(state.sessionCount).toBe(0);
  });

  test("reads the title from a frontmatter title field", () => {
    writeSession(ymd(1), 'title: "Fixed the parser"\n\nbody');

    expect(synthesize(7).sessions[0].titles).toEqual(["Fixed the parser"]);
  });

  test("reads the title from a bold Title marker", () => {
    writeSession(ymd(1), "**Title:** Bold style\n\nbody");

    expect(synthesize(7).sessions[0].titles).toEqual(["Bold style"]);
  });

  test("falls back to the filename when no title is present", () => {
    writeSession(ymd(1), "no title here");

    expect(synthesize(7).sessions[0].titles).toEqual([`${ymd(1)}-run`]);
  });

  test("groups titles by date, newest first", () => {
    writeSession(ymd(1), "title: Yesterday");
    writeSession(ymd(0), "title: Today");

    const dates = synthesize(7).sessions.map((s) => s.date);

    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe(iso(0).slice(0, 10));
  });

  test("counts every session across all dates", () => {
    writeSession(ymd(1), "title: One");
    writeSession(ymd(2), "title: Two");

    expect(synthesize(7).sessionCount).toBe(2);
  });

  test("excludes sessions older than the window", () => {
    writeSession(ymd(1), "title: Recent");
    writeSession(ymd(40), "title: Ancient");

    const titles = synthesize(7).sessions.flatMap((s) => s.titles);

    expect(titles).toContain("Recent");
    expect(titles).not.toContain("Ancient");
  });
});

describe("synthesize — envelope", () => {
  test("records the requested window and a timestamp", () => {
    const state = synthesize(14);

    expect(state.days).toBe(14);
    expect(state.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("writeSynthesis", () => {
  test("writes the state to synthesis.json and returns its path", () => {
    const state = synthesize(7);

    const path = writeSynthesis(state);

    expect(path.endsWith("synthesis.json")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8")).days).toBe(7);
  });

  test("writes a signal cache alongside it", () => {
    writeRatings([
      { ts: iso(0), rating: 8 },
      { ts: iso(3), rating: 6 },
    ]);

    writeSynthesis(synthesize(7));

    const cache = JSON.parse(
      readFileSync(resolve(HOME, "memory", "state", "signal-cache.json"), "utf-8")
    );
    expect(cache.today).toBe(8);
    expect(cache.week).toBe(7);
    expect(cache.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("leaves cache windows null when no rating falls in them", () => {
    writeRatings([{ ts: iso(60), rating: 9 }]);

    writeSynthesis(synthesize(7));

    const cache = JSON.parse(
      readFileSync(resolve(HOME, "memory", "state", "signal-cache.json"), "utf-8")
    );
    expect(cache.today).toBeNull();
    expect(cache.week).toBeNull();
    expect(cache.month).toBeNull();
  });

  test("marks the cache trend up when recent ratings rise", () => {
    writeRatings([
      ...Array.from({ length: 6 }, () => ({ ts: iso(2), rating: 4 })),
      ...Array.from({ length: 6 }, () => ({ ts: iso(1), rating: 9 })),
    ]);

    writeSynthesis(synthesize(7));

    const cache = JSON.parse(
      readFileSync(resolve(HOME, "memory", "state", "signal-cache.json"), "utf-8")
    );
    expect(cache.trend).toBe("up");
  });

  test("marks the cache trend down when recent ratings fall", () => {
    writeRatings([
      ...Array.from({ length: 6 }, () => ({ ts: iso(2), rating: 9 })),
      ...Array.from({ length: 6 }, () => ({ ts: iso(1), rating: 4 })),
    ]);

    writeSynthesis(synthesize(7));

    const cache = JSON.parse(
      readFileSync(resolve(HOME, "memory", "state", "signal-cache.json"), "utf-8")
    );
    expect(cache.trend).toBe("down");
  });
});
