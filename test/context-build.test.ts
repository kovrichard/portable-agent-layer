import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSystemReminder,
  loadRelationshipContext,
  loadSessionIntelligence,
  loadWisdomContext,
} from "../src/hooks/lib/context";
import { writeProject } from "../src/hooks/lib/projects";
import { reload } from "../src/hooks/lib/settings";
import { appendProjectHistory } from "../src/hooks/lib/work-tracking";

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
  reload();
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

describe("learnings from other folders", () => {
  test("stay out of the session-start context", () => {
    learning("Elsewhere thing", "/some/other/project");

    expect(buildSystemReminder()).not.toContain("Elsewhere thing");
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

  test("keeps a session entry whose cwd stamp is anchored to the current project", () => {
    write(
      "memory/projects/here/ISA.md",
      `---\nname: "here"\npath: "${process.cwd()}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n`
    );
    notes("## 09:00\n<!-- cwd:{proj:here} -->\n- Session: anchored work\n");

    expect(loadRelationshipContext()).toContain("- Session: anchored work");
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
  function optInToDueReminders() {
    write(
      "memory/pal-settings.json",
      JSON.stringify({ dynamicContext: { dueReminders: true } })
    );
    reload();
  }

  test("leaves due reminders out until the user opts in", () => {
    expect(buildSystemReminder({ agent: "cursor" })).not.toContain(
      "## Learning Analysis Due"
    );
  });

  test("surfaces the analyze nudge at startup for an agent with no per-turn context", () => {
    optInToDueReminders();
    const out = buildSystemReminder({ agent: "cursor" });

    expect(out).toContain("## Learning Analysis Due");
    expect(out).toContain("/pal-analyze");
  });

  test("keeps the analyze nudge in every session until a reply passes it on", () => {
    optInToDueReminders();
    expect(buildSystemReminder({ agent: "cursor" })).toContain(
      "## Learning Analysis Due"
    );
    expect(buildSystemReminder({ agent: "cursor" })).toContain(
      "## Learning Analysis Due"
    );
  });

  test("leaves due nudges to the per-turn context where the agent hears it", () => {
    optInToDueReminders();
    expect(buildSystemReminder({ agent: "claude" })).not.toContain(
      "## Learning Analysis Due"
    );
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

  test("includes wisdom for Codex, whose AGENTS.md has no import mechanism", () => {
    frame("development", "### Injected principle [CRYSTAL: 90%]\nbody");

    expect(buildSystemReminder({ agent: "codex" })).toContain("Injected principle");
  });

  test("drops only the handoff when asked to go without it", () => {
    write(
      "memory/state/last-handoff.json",
      JSON.stringify({
        [process.cwd()]: {
          title: "open work",
          handoff: "finish the gate",
          status: "in-progress",
          timestamp: new Date().toISOString(),
        },
      })
    );
    notes("## 09:00\n- W: a fact\n");

    expect(buildSystemReminder()).toContain("finish the gate");
    const out = buildSystemReminder({ withoutHandoff: true });
    expect(out).not.toContain("finish the gate");
    expect(out).toContain("- W: a fact");
  });

  test("leaves past sessions to the handoff and the active projects list", () => {
    appendProjectHistory(process.cwd(), {
      date: "2026-09-30",
      title: "An earlier session here",
      summary: "What that session did.",
      insights: "",
    });

    expect(buildSystemReminder()).not.toContain("An earlier session here");
  });

  test("marks the project the session started in, not the folder it moved to", () => {
    const startDir = resolve(HOME, "started-here");
    mkdirSync(startDir, { recursive: true });
    writeProject({
      name: "started-here",
      path: startDir,
      status: "active",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    const savedStart = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = startDir;
    try {
      expect(buildSystemReminder()).toContain("**started-here** (just now) → here");
    } finally {
      if (savedStart === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedStart;
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
  test("stays out of the startup context until its stats are worth reading", () => {
    synthesis({
      algorithm: {
        reflectionCount: 4,
        passRate: 60,
        avgSentiment: 8,
        recentObservations: [],
      },
    });

    expect(buildSystemReminder()).not.toContain("## Session Intelligence");
  });

  test("is absent when no synthesis has been written", () => {
    expect(loadSessionIntelligence()).toBe("");
  });

  test("leaves ratings to the self-model, which is built from them", () => {
    synthesis({ ratings: ratings({ lowCount: 6, trend: "declining" }) });

    const out = loadSessionIntelligence();

    expect(out).toBe("");
    expect(out).not.toContain("Rating trend");
    expect(out).not.toContain("low ratings");
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

    expect(loadSessionIntelligence()).toContain(
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

    expect(loadSessionIntelligence()).toContain("→ Criteria pass rate is low.");
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

    expect(loadSessionIntelligence()).not.toContain("Criteria pass rate is low");
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

    const out = loadSessionIntelligence();

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

    expect(loadSessionIntelligence()).not.toContain("not mine");
  });

  test("ignores a malformed synthesis file", () => {
    write("memory/state/synthesis.json", "{ not json");

    expect(loadSessionIntelligence()).toBe("");
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
    expect(out).toContain("*Previous session: a previous session · 0m ago*");
    expect(out).toContain("the remaining work");
    expect(out).toContain("→ Continue this work");
  });

  test("a finished session stays available for follow-ups, not as open work", () => {
    handoff({ status: "completed", lastUser: "what about the gate?" });

    const out = buildSystemReminder();
    expect(out).toContain("- User: what about the gate?");
    expect(out).not.toContain("→ Continue this work");
  });

  test("drops a handoff older than a week", () => {
    handoff({ timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).not.toContain("Pick Up Where You Left Off");
  });

  test("keeps a handoff from within the week", () => {
    handoff({ timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() });

    expect(buildSystemReminder()).toContain("Pick Up Where You Left Off");
  });

  test("shows another folder's handoff only as the conversation elsewhere", () => {
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

    const out = buildSystemReminder();
    expect(out).not.toContain("Pick Up Where You Left Off");
    expect(out).toContain("## Last Conversation Elsewhere");
    expect(out).toContain("someone else work");
  });
});
