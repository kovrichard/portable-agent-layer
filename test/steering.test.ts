import { describe, expect, test } from "bun:test";
import { classifyPrompt, getSteeringReminder } from "../src/hooks/lib/steering";

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
    // debugging is declared before destructive → order is stable, not prompt order
    expect(classifyPrompt("remove the crashing handler")).toEqual([
      "debugging",
      "destructive",
    ]);
  });

  // Negative controls — proves the classifier isn't matching everything.
  test("greeting matches nothing", () => {
    expect(classifyPrompt("hey Jarvis, good morning")).toEqual([]);
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
});
