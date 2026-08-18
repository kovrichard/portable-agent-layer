import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSystemReminder,
  loadLearningDigest,
  loadRelationshipContext,
  loadWisdomContext,
} from "../src/hooks/lib/context";

const HOME = resolve(import.meta.dir, "../.test-home-context-build");
const savedHome = process.env.PAL_HOME;

function write(relPath: string, content: string) {
  const full = resolve(HOME, relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

function frame(domain: string, body: string) {
  write(`memory/wisdom/frames/${domain}.md`, body);
}

function today(offset = 0): { month: string; day: string } {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { month: `${yyyy}-${mm}`, day: `${yyyy}-${mm}-${dd}` };
}

function notes(body: string) {
  const { month, day } = today();
  write(`memory/relationship/${month}/${day}.md`, body);
}

function learning(title: string, cwd: string, offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const stamp = `${yyyy}${mm}${String(d.getDate()).padStart(2, "0")}-${title.replace(/\W/g, "")}`;
  write(
    `memory/learning/session/${yyyy}/${mm}/${stamp}.md`,
    `---\ntitle: "${title}"\ncwd: ${cwd}\n---\n\nbody\n`
  );
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  rmSync(HOME, { recursive: true, force: true });
});

describe("loadWisdomContext", () => {
  test("is empty when no frames exist", () => {
    expect(loadWisdomContext()).toBe("");
  });

  test("lists a crystallized principle under a heading", () => {
    frame("development", "### Always measure first [CRYSTAL: 90%]\nbody");

    const out = loadWisdomContext();

    expect(out).toContain("## Crystallized Principles");
    expect(out).toContain("- [development] Always measure first (90%)");
  });

  test("omits a principle below the confidence bar", () => {
    frame("development", "### Too uncertain [CRYSTAL: 60%]\nbody");

    expect(loadWisdomContext()).toBe("");
  });

  test("keeps a principle exactly at the bar", () => {
    frame("development", "### Right at the line [CRYSTAL: 85%]\nbody");

    expect(loadWisdomContext()).toContain("Right at the line");
  });
});

describe("loadLearningDigest", () => {
  test("is empty when nothing has been learned", () => {
    expect(loadLearningDigest()).toBe("");
  });

  test("omits learnings from the current project", () => {
    learning("Same project thing", process.cwd());

    expect(loadLearningDigest()).toBe("");
  });

  test("lists learnings from other projects under a heading", () => {
    learning("Elsewhere thing", "/some/other/project");

    const out = loadLearningDigest();

    expect(out).toContain("## Other Recent Learnings");
    expect(out).toContain("- Elsewhere thing");
  });

  test("lists at most five cross-project learnings", () => {
    for (let i = 0; i < 8; i++) learning(`Thing ${i}`, `/other/${i}`, i);

    const listed = loadLearningDigest()
      .split("\n")
      .filter((l) => l.startsWith("- "));

    expect(listed).toHaveLength(5);
  });
});

describe("loadRelationshipContext", () => {
  test("is empty when there are no notes", () => {
    expect(loadRelationshipContext()).toBe("");
  });

  test("keeps world facts under a heading", () => {
    notes("## 09:00\n- W: uses bun everywhere\n");

    const out = loadRelationshipContext();

    expect(out).toContain("## Recent Interaction Notes");
    expect(out).toContain("- W: uses bun everywhere");
  });

  test("strips opinion entries, which load natively elsewhere", () => {
    notes("## 09:00\n- O(c=0.9): prefers terse replies\n- W: a fact\n");

    const out = loadRelationshipContext();

    expect(out).not.toContain("prefers terse replies");
    expect(out).toContain("- W: a fact");
  });

  test("keeps a session entry recorded in the current project", () => {
    notes(
      `## 09:00\n<!-- session:abc cwd:${process.cwd()} -->\n- Session: did the thing\n`
    );

    expect(loadRelationshipContext()).toContain("- Session: did the thing");
  });

  test("drops a session entry recorded in another project", () => {
    notes("## 09:00\n<!-- session:abc cwd:/elsewhere -->\n- Session: unrelated work\n");

    expect(loadRelationshipContext()).not.toContain("unrelated work");
  });

  test("keeps a legacy session entry that carries no cwd", () => {
    notes("## 09:00\n- Session: legacy entry\n");

    expect(loadRelationshipContext()).toContain("- Session: legacy entry");
  });

  test("strips the html comments themselves", () => {
    notes("## 09:00\n<!-- session:abc cwd:/elsewhere -->\n- W: a fact\n");

    expect(loadRelationshipContext()).not.toContain("<!--");
  });

  test("resets project scoping at each timestamp block", () => {
    notes(
      `## 09:00\n<!-- session:a cwd:/elsewhere -->\n- Session: other project\n` +
        `## 10:00\n- Session: no cwd so kept\n`
    );

    const out = loadRelationshipContext();

    expect(out).not.toContain("other project");
    expect(out).toContain("no cwd so kept");
  });
});

describe("buildSystemReminder", () => {
  // A bare home is not silent: the analyze nudge and the unregistered-project
  // hint both fire, which is the behaviour worth pinning here.
  test("surfaces the analyze nudge when analysis has never run", () => {
    const out = buildSystemReminder();

    expect(out).toContain("## Learning Analysis Due");
    expect(out).toContain("/pal-analyze");
  });

  test("wraps content in a system-reminder with the current time", () => {
    notes("## 09:00\n- W: a fact\n");

    const out = buildSystemReminder();

    expect(out.startsWith("<system-reminder>")).toBe(true);
    expect(out.trimEnd().endsWith("</system-reminder>")).toBe(true);
    expect(out).toContain("**Current time:**");
  });

  test("omits wisdom for an agent that loads it natively", () => {
    frame("development", "### Native principle [CRYSTAL: 90%]\nbody");
    notes("## 09:00\n- W: a fact\n");

    expect(buildSystemReminder({ agent: "claude" })).not.toContain("Native principle");
  });

  // Every member of AgentTarget loads semi-static context natively, so the hook
  // only injects it when no agent is named — the path Codex takes.
  test("includes wisdom when no agent is named", () => {
    frame("development", "### Injected principle [CRYSTAL: 90%]\nbody");

    expect(buildSystemReminder()).toContain("Injected principle");
  });

  test("omits wisdom for every agent that loads it natively", () => {
    frame("development", "### Native principle [CRYSTAL: 90%]\nbody");

    for (const agent of ["claude", "opencode", "cursor", "copilot"] as const) {
      expect(buildSystemReminder({ agent })).not.toContain("Native principle");
    }
  });

  test("still includes relationship notes for a native-loading agent", () => {
    notes("## 09:00\n- W: still injected\n");

    expect(buildSystemReminder({ agent: "claude" })).toContain("- W: still injected");
  });
});

function synthesis(state: Record<string, unknown>) {
  write("memory/state/synthesis.json", JSON.stringify(state));
}

function ratings(over: Record<string, unknown> = {}) {
  return { count: 10, avg: 7, recentAvg: 7, lowCount: 0, trend: "stable", ...over };
}

function handoff(over: Record<string, unknown> = {}) {
  write(
    "memory/state/last-handoff.json",
    JSON.stringify({
      [process.cwd()]: {
        handoff: "the remaining work",
        title: "a previous session",
        status: "in-progress",
        timestamp: new Date().toISOString(),
        ...over,
      },
    })
  );
}

describe("session intelligence", () => {
  test("is absent when no synthesis has been written", () => {
    expect(buildSystemReminder()).not.toContain("## Session Intelligence");
  });

  test("reports the rating trend line", () => {
    synthesis({ ratings: ratings({ avg: 8, recentAvg: 9, trend: "improving" }) });

    const out = buildSystemReminder();

    expect(out).toContain("**Rating trend:** 8/10 avg (last 10: 9/10, improving).");
    expect(out).toContain("→ Trend is improving. Maintain current approach.");
  });

  test("warns when the trend is declining", () => {
    synthesis({ ratings: ratings({ trend: "declining" }) });

    expect(buildSystemReminder()).toContain("→ Trend is declining.");
  });

  test("notes the low-rating count when there is one", () => {
    synthesis({ ratings: ratings({ lowCount: 2 }) });

    expect(buildSystemReminder()).toContain("2 low ratings.");
  });

  test("omits the low-rating note when there are none", () => {
    synthesis({ ratings: ratings({ lowCount: 0 }) });

    expect(buildSystemReminder()).not.toContain("low ratings.");
  });

  test("advises slowing down when many ratings are low and the trend is flat", () => {
    synthesis({ ratings: ratings({ lowCount: 6, trend: "stable" }) });

    expect(buildSystemReminder()).toContain("→ Multiple low ratings.");
  });

  test("skips the ratings block when nothing was rated", () => {
    synthesis({ ratings: ratings({ count: 0 }) });

    expect(buildSystemReminder()).not.toContain("**Rating trend:**");
  });

  test("reports algorithm performance", () => {
    synthesis({
      algorithm: {
        reflectionCount: 4,
        passRate: 95,
        avgSentiment: 8,
        recentObservations: [],
      },
    });

    expect(buildSystemReminder()).toContain(
      "**Algorithm:** 4 reflections, 95% criteria pass rate, 8/10 sentiment."
    );
  });

  test("flags a low criteria pass rate", () => {
    synthesis({
      algorithm: {
        reflectionCount: 4,
        passRate: 60,
        avgSentiment: 8,
        recentObservations: [],
      },
    });

    expect(buildSystemReminder()).toContain("→ Criteria pass rate is low.");
  });

  test("stays quiet about a healthy pass rate", () => {
    synthesis({
      algorithm: {
        reflectionCount: 4,
        passRate: 95,
        avgSentiment: 8,
        recentObservations: [],
      },
    });

    expect(buildSystemReminder()).not.toContain("Criteria pass rate is low");
  });

  test("shows observations recorded in this project", () => {
    synthesis({
      algorithm: {
        reflectionCount: 1,
        passRate: 90,
        avgSentiment: 8,
        recentObservations: [
          {
            date: "2026-08-18",
            cwd: process.cwd(),
            task: "a task",
            observation: "a lesson",
          },
        ],
      },
    });

    const out = buildSystemReminder();

    expect(out).toContain("Recent self-observations (this project):");
    expect(out).toContain('- [2026-08-18] a task: "a lesson"');
  });

  test("hides observations recorded elsewhere", () => {
    synthesis({
      algorithm: {
        reflectionCount: 1,
        passRate: 90,
        avgSentiment: 8,
        recentObservations: [
          {
            date: "2026-08-18",
            cwd: "/elsewhere",
            task: "other",
            observation: "not mine",
          },
        ],
      },
    });

    expect(buildSystemReminder()).not.toContain("not mine");
  });

  test("ignores a malformed synthesis file", () => {
    write("memory/state/synthesis.json", "{ not json");

    expect(buildSystemReminder()).not.toContain("## Session Intelligence");
  });
});

describe("handoff", () => {
  test("is absent when no handoff was recorded", () => {
    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("surfaces an in-progress handoff for this project", () => {
    handoff();

    const out = buildSystemReminder();

    expect(out).toContain("## Pick Up Where You Left Off");
    expect(out).toContain("*Previous session: a previous session*");
    expect(out).toContain("the remaining work");
  });

  test("stays silent once the handoff is done", () => {
    handoff({ status: "done" });

    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("drops a handoff older than a week", () => {
    handoff({ timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("keeps a handoff from within the week", () => {
    handoff({ timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).toContain("Pick Up Where You Left Off");
  });

  test("ignores a handoff belonging to another project", () => {
    write(
      "memory/state/last-handoff.json",
      JSON.stringify({
        "/elsewhere": {
          handoff: "someone else work",
          title: "t",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
      })
    );

    expect(buildSystemReminder()).not.toContain("someone else work");
  });
});
