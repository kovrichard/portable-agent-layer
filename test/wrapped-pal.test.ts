import { beforeEach, describe, expect, test } from "bun:test";
import type { SkillIndex } from "../src/hooks/lib/skill-match";
import { wrappedPal } from "../src/tools/lib/wrapped/pal";
import { palLines } from "../src/tools/lib/wrapped/render";
import { budapestHome, event } from "./lib/wrapped-events";

beforeEach(() => {
  budapestHome(import.meta.file);
});

function indexOf(...names: string[]): SkillIndex {
  return {
    skills: Object.fromEntries(names.map((name) => [name, { name, description: "" }])),
  };
}

const skillCall = (skill: string, ts = "2026-06-01T10:00:00.000Z") =>
  event("tool_call", { tool: "Skill", skill }, { ts });

describe("PAL", () => {
  test("nothing logged and no skill index shows nothing known", () => {
    expect(wrappedPal([], null)).toEqual({
      skillsUsed: [],
      skillsNeverUsed: null,
      promisesOnTime: null,
      promisesKept: 0,
    });
  });

  test("skills used are counted on tool calls that loaded one", () => {
    const pal = wrappedPal(
      [
        skillCall("think"),
        event("tool_call", { tool: "Bash" }),
        skillCall("projects"),
        skillCall("think"),
      ],
      null
    );
    expect(pal.skillsUsed).toEqual([
      { name: "think", count: 2 },
      { name: "projects", count: 1 },
    ]);
  });

  test("never used is the installed skills nobody loaded, since the first logged tool call", () => {
    const pal = wrappedPal(
      [
        skillCall("think", "2026-06-02T10:00:00.000Z"),
        event("tool_call", { tool: "Bash" }, { ts: "2026-05-31T22:30:00.000Z" }),
        skillCall("retired-skill"),
      ],
      indexOf("think", "telos", "council")
    );
    expect(pal.skillsNeverUsed).toEqual({
      names: ["council", "telos"],
      installed: 3,
      since: "2026-06-01",
    });
  });

  test("without a logged tool call or a skill index, never used is unknown", () => {
    expect(wrappedPal([], indexOf("think")).skillsNeverUsed).toBeNull();
    expect(wrappedPal([skillCall("think")], null).skillsNeverUsed).toBeNull();
  });

  test("a promise is on time when done by its due time; one dropped or undated is not counted", () => {
    const pal = wrappedPal(
      [
        event("promise", { change: "done", lateSec: -60 }),
        event("promise", { change: "done", lateSec: 0 }),
        event("promise", { change: "done", lateSec: 1 }),
        event("promise", { change: "done", lateSec: null }),
        event("promise", { change: "dropped", lateSec: -60 }),
        event("promise", { change: "made", dueInSec: 60 }),
      ],
      null
    );
    expect(pal.promisesOnTime).toBe(2);
    expect(pal.promisesKept).toBe(3);
  });
});

describe("PAL as printed", () => {
  test("skills, never-used names and promises print, and rules stay unknown", () => {
    expect(
      palLines({
        skillsUsed: [{ name: "projects", count: 1200 }],
        skillsNeverUsed: {
          names: ["council", "telos"],
          installed: 3,
          since: "2026-10-12",
        },
        promisesOnTime: 1,
        promisesKept: 2,
      })
    ).toEqual([
      "\n  PAL\n",
      "    skills used          projects 1,200",
      "    skills never used    2 of 3 since 2026-10-12",
      "                         council, telos",
      "    rules approved       unknown",
      "    promises on time     1 of 2",
    ]);
  });

  test("every skill used prints no name list; unknowns say so", () => {
    expect(
      palLines({
        skillsUsed: [],
        skillsNeverUsed: { names: [], installed: 1, since: "2026-10-12" },
        promisesOnTime: null,
        promisesKept: 0,
      }).slice(1)
    ).toEqual([
      "    skills used          unknown",
      "    skills never used    0 of 1 since 2026-10-12",
      "    rules approved       unknown",
      "    promises on time     unknown",
    ]);
    expect(
      palLines({
        skillsUsed: [],
        skillsNeverUsed: null,
        promisesOnTime: null,
        promisesKept: 0,
      })[2]
    ).toBe("    skills never used    unknown");
  });
});
