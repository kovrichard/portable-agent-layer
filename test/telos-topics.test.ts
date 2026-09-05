import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { hasRealContent, telosStatus } from "../src/hooks/lib/telos-topics";

// One definition of "answered" serves the doctor, `pal cli telos` and the
// onboarding skill, so what counts as scaffolding is pinned here.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-telos-topics-"));
  mkdirSync(resolve(HOME, "telos"), { recursive: true });
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

function writeTopic(name: string, body: string): string {
  const path = resolve(HOME, "telos", name);
  writeFileSync(path, body);
  return path;
}

describe("hasRealContent", () => {
  test("a file that was never created is unanswered", () => {
    expect(hasRealContent(resolve(HOME, "telos", "NOPE.md"))).toBe(false);
  });

  test("a heading and a prompt comment say nothing", () => {
    const path = writeTopic("MISSION.md", "# Mission\n\n<!-- What drives you? -->\n");
    expect(hasRealContent(path)).toBe(false);
  });

  test("a horizontal rule is decoration, not an answer", () => {
    const path = writeTopic("MISSION.md", "# Mission\n\n---\n\n***\n___\n");
    expect(hasRealContent(path)).toBe(false);
  });

  test("bullets with nothing after the marker are still the scaffold", () => {
    const path = writeTopic(
      "GOALS.md",
      "# Goals\n\n## Short-term\n-\n\n## Long-term\n-\n"
    );
    expect(hasRealContent(path)).toBe(false);
  });

  test("one written line makes the topic answered", () => {
    const path = writeTopic("GOALS.md", "# Goals\n\n## Short-term\n- Ship the thing\n");
    expect(hasRealContent(path)).toBe(true);
  });

  test("a table row counts — some topics are kept as tables", () => {
    const path = writeTopic("MODELS.md", "# Mental Models\n\n| Model | Use |\n");
    expect(hasRealContent(path)).toBe(true);
  });

  test("an indented answer counts, and indented scaffolding does not", () => {
    expect(hasRealContent(writeTopic("A.md", "  # Heading\n   -   \n"))).toBe(false);
    expect(hasRealContent(writeTopic("B.md", "  # Heading\n   - real\n"))).toBe(true);
  });
});

describe("the shipped scaffolds", () => {
  test("every template PAL installs reads as unanswered", () => {
    const dir = resolve(import.meta.dir, "..", "assets", "templates", "telos");
    const templates = readdirSync(dir).filter((f) => f.endsWith(".md"));

    expect(templates.length).toBe(9);
    for (const file of templates) {
      expect({ file, answered: hasRealContent(resolve(dir, file)) }).toEqual({
        file,
        answered: false,
      });
    }
  });
});

describe("telosStatus", () => {
  test("lists nine topics in interview order, priority first", () => {
    const topics = telosStatus(HOME);

    expect(topics).toHaveLength(9);
    expect(topics.slice(0, 5).map((t) => t.key)).toEqual([
      "mission",
      "goals",
      "challenges",
      "strategies",
      "beliefs",
    ]);
    expect(topics.filter((t) => t.priority)).toHaveLength(5);
    expect(topics.filter((t) => !t.priority).map((t) => t.key)).toEqual([
      "models",
      "narratives",
      "learned",
      "ideas",
    ]);
  });

  test("reads unanswered on a home that has no telos files at all", () => {
    expect(telosStatus(HOME).every((t) => t.answered === false)).toBe(true);
  });

  test("flips a single topic once it has been answered", () => {
    writeTopic("MISSION.md", "# Mission\n\nBuild an operational mapping practice.\n");
    const topics = telosStatus(HOME);

    expect(topics.find((t) => t.key === "mission")?.answered).toBe(true);
    expect(topics.filter((t) => t.answered)).toHaveLength(1);
  });

  test("resolves each path under the home it was given", () => {
    expect(telosStatus(HOME)[0]?.path).toBe(resolve(HOME, "telos", "MISSION.md"));
  });
});
