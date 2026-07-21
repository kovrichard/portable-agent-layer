import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyPrompt, getSteeringReminder } from "../src/hooks/lib/steering";

// Steering reads user rules / disables from pal-settings.json, so these tests run
// against an isolated PAL_HOME to stay deterministic regardless of the real config.
const TEST_HOME = resolve(import.meta.dir, "../.test-home-steering");

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
  const p = resolve(TEST_HOME, "memory", "pal-settings.json");
  if (existsSync(p)) rmSync(p);
  const settings = await import("../src/hooks/lib/settings");
  settings.reload();
});

async function setSettings(data: Record<string, unknown>) {
  writeFileSync(resolve(TEST_HOME, "memory", "pal-settings.json"), JSON.stringify(data));
  const settings = await import("../src/hooks/lib/settings");
  settings.reload();
}

describe("classifyPrompt", () => {
  test("tags a debugging prompt", () => {
    expect(classifyPrompt("the build is broken and the test keeps failing")).toContain(
      "debugging"
    );
  });

  test("tags a destructive prompt", () => {
    expect(classifyPrompt("delete the old config and force push")).toContain(
      "destructive"
    );
  });

  test("tags a refactor prompt", () => {
    expect(classifyPrompt("let's refactor and clean up this module")).toContain(
      "refactor"
    );
  });

  test("tags a planning prompt", () => {
    expect(classifyPrompt("let's plan the migration and design the schema")).toContain(
      "planning"
    );
  });

  test("tags a testing prompt", () => {
    expect(classifyPrompt("add a test for the parser and check coverage")).toContain(
      "testing"
    );
  });

  test("tags a committing prompt", () => {
    expect(classifyPrompt("commit this and open a PR")).toContain("committing");
    expect(classifyPrompt("git push the branch")).toContain("committing");
  });

  test("tags a secrets prompt", () => {
    expect(classifyPrompt("store the api key and rotate the token")).toContain("secrets");
  });

  // Word-boundary guard: a "push notification" is not a git push.
  test("'push notification' does not trigger committing", () => {
    expect(classifyPrompt("I got a push notification on my phone")).toEqual([]);
  });

  test("returns multiple tags in declaration order", () => {
    expect(classifyPrompt("remove the crashing handler")).toEqual([
      "debugging",
      "destructive",
    ]);
  });

  // Negative controls — proves the classifier isn't matching everything.
  test("greeting matches nothing", () => {
    expect(classifyPrompt("hey there, good morning")).toEqual([]);
  });

  test("empty / whitespace matches nothing", () => {
    expect(classifyPrompt("")).toEqual([]);
    expect(classifyPrompt("   ")).toEqual([]);
  });

  test("word-boundary guard: 'warm' does not trigger destructive rm", () => {
    expect(classifyPrompt("warm up the cache")).toEqual([]);
  });
});

describe("getSteeringReminder", () => {
  test("wraps matched steering in one system-reminder block", () => {
    const out = getSteeringReminder("the build is broken");
    expect(out).not.toBeNull();
    expect(out).toContain("<system-reminder>");
    expect(out).toContain("</system-reminder>");
    expect(out).toContain("Debugging something?");
  });

  test("non-matching prompt injects nothing", () => {
    expect(getSteeringReminder("good morning")).toBeNull();
  });

  test("emits exactly one system-reminder open tag even with multiple tags", () => {
    const out = getSteeringReminder("remove the crashing handler") ?? "";
    expect(out.match(/<system-reminder>/g)?.length).toBe(1);
    expect(out).toContain("Debugging something?");
    expect(out).toContain("force-push");
  });

  // The shipped committing rule must stay universal — no "branch first" opinion.
  test("shipped committing rule is workflow-neutral", () => {
    const out = getSteeringReminder("commit this") ?? "";
    expect(out).toContain("Only do it if it was asked");
    expect(out).not.toContain("branch first");
  });
});

describe("user extension via pal-settings.json", () => {
  test("a user rule from settings fires", async () => {
    await setSettings({
      steering: {
        rules: [
          {
            tag: "deploy",
            pattern: "deploy|ship to prod",
            snippet: "Deploying? Confirm the target env first.",
          },
        ],
      },
    });
    expect(classifyPrompt("deploy to prod now")).toContain("deploy");
    expect(getSteeringReminder("deploy to prod now")).toContain(
      "Confirm the target env first"
    );
  });

  test("disable suppresses a shipped rule by tag", async () => {
    await setSettings({ steering: { disable: ["committing"] } });
    expect(classifyPrompt("commit this and open a PR")).toEqual([]);
  });

  test("malformed user rule (bad regex) is skipped, not thrown", async () => {
    await setSettings({
      steering: {
        rules: [
          { tag: "bad", pattern: "(", snippet: "unreachable" },
          { tag: "widgets", pattern: "widget", snippet: "Widget rule fired." },
        ],
      },
    });
    // The bad regex must not crash classification, and the valid rule still works.
    expect(() => classifyPrompt("a broken (paren")).not.toThrow();
    expect(classifyPrompt("build a widget")).toEqual(["widgets"]);
  });
});
