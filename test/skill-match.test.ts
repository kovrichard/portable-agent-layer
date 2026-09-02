import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { matchSkills, type SkillIndex } from "../src/hooks/lib/skill-match";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-skill-match");

const INDEX: SkillIndex = {
  skills: {
    presentation: {
      name: "presentation",
      description: "Build branded HTML presentations from markdown using Reveal.js.",
      triggers: ["slide deck", "slides", "pitch deck"],
    },
    review: {
      name: "review",
      description: "Security-focused code review with severity ratings.",
      triggers: ["security review", "owasp"],
    },
    bare: { name: "bare", description: "No triggers at all.", triggers: [] },
  },
};

function writeIndex(index: SkillIndex) {
  mkdirSync(resolve(TEST_HOME, "memory", "state"), { recursive: true });
  writeFileSync(
    resolve(TEST_HOME, "memory", "state", "skill-index.json"),
    JSON.stringify(index)
  );
}

async function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  (await import("../src/hooks/lib/settings")).reload();
}

async function loadMatcher() {
  const mod = await import(`../src/hooks/lib/skill-match.ts?t=${Date.now()}`);
  return mod.getSkillReminder as (prompt: string) => string | null;
}

beforeAll(() => {
  process.env.PAL_HOME = TEST_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(resolve(TEST_HOME, "memory"), { recursive: true });
});

afterAll(() => {
  delete process.env.PAL_HOME;
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(async () => {
  const settingsPath = resolve(TEST_HOME, "memory", "pal-settings.json");
  if (existsSync(settingsPath)) rmSync(settingsPath);
  (await import("../src/hooks/lib/settings")).reload();
  writeIndex(INDEX);
});

describe("matchSkills", () => {
  test("matches a multi-word trigger phrase in the prompt", () => {
    const matches = matchSkills("can you put together a slide deck for friday", INDEX);

    expect(matches.map((m) => m.name)).toEqual(["presentation"]);
    expect(matches[0].matched).toContain("slide deck");
  });

  test("matches a single-word trigger on a whole word only", () => {
    expect(matchSkills("rewrite these slides", INDEX)).toHaveLength(1);
    expect(matchSkills("check the slidesheet layout", INDEX)).toHaveLength(0);
  });

  test("ignores punctuation and casing on both sides", () => {
    expect(matchSkills("Do an OWASP-style pass, please.", INDEX)[0].name).toBe("review");
  });

  test("ranks a phrase hit above a single-word hit", () => {
    const index: SkillIndex = {
      skills: {
        alpha: { name: "alpha", description: "", triggers: ["deck"] },
        zeta: { name: "zeta", description: "", triggers: ["slide deck"] },
      },
    };

    expect(matchSkills("build a slide deck", index).map((m) => m.name)).toEqual([
      "zeta",
      "alpha",
    ]);
  });

  test("returns at most three skills", () => {
    const skills: SkillIndex["skills"] = {};
    for (const n of ["a", "b", "c", "d"]) {
      skills[n] = { name: n, description: "", triggers: ["slides"] };
    }

    expect(matchSkills("about slides", { skills })).toHaveLength(3);
  });

  test("returns nothing for a prompt that hits no trigger", () => {
    expect(matchSkills("rename the database column", INDEX)).toEqual([]);
  });

  test("returns nothing for an empty prompt", () => {
    expect(matchSkills("   ", INDEX)).toEqual([]);
  });

  test("skips a skill whose trigger list is empty", () => {
    expect(matchSkills("bare", INDEX)).toEqual([]);
  });
});

describe("getSkillReminder", () => {
  test("names the matched skill and the trigger that matched it", async () => {
    const reminder = (await loadMatcher())("make me a pitch deck");

    expect(reminder).toContain("Potential matching skills");
    expect(reminder).toContain("- presentation —");
    expect(reminder).toContain('"pitch deck"');
    expect(reminder).toStartWith("<system-reminder>");
  });

  test("returns null when nothing matches", async () => {
    expect((await loadMatcher())("rename the database column")).toBeNull();
  });

  test("returns null when there is no skill index on disk", async () => {
    rmSync(resolve(TEST_HOME, "memory", "state", "skill-index.json"));

    expect((await loadMatcher())("make me a pitch deck")).toBeNull();
  });

  test("returns null when the index is unreadable", async () => {
    writeFileSync(
      resolve(TEST_HOME, "memory", "state", "skill-index.json"),
      "{ not json"
    );

    expect((await loadMatcher())("make me a pitch deck")).toBeNull();
  });

  test("respects the skillMatching kill switch", async () => {
    await setSettings({ dynamicContext: { skillMatching: false } });

    expect((await loadMatcher())("make me a pitch deck")).toBeNull();
  });
});
