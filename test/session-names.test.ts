import { describe, expect, test } from "bun:test";
import { extractFallbackName } from "../src/hooks/lib/session-names";

describe("extractFallbackName", () => {
  test("extracts meaningful keywords", () => {
    const name = extractFallbackName("fix the authentication token refresh bug");
    expect(name).toBe("Fix Authentication Token Refresh");
  });

  test("filters noise words", () => {
    const name = extractFallbackName("I just want to make something work");
    // all words are noise except maybe none — should get "untitled session"
    expect(name).not.toContain("just");
    expect(name).not.toContain("want");
  });

  test("deduplicates words", () => {
    const name = extractFallbackName("debug debug debug auth");
    expect(name).toBe("Debug Auth");
  });

  test("returns untitled session for empty input", () => {
    expect(extractFallbackName("")).toBe("untitled session");
    expect(extractFallbackName("I a the")).toBe("untitled session");
  });

  test("strips system-reminder blocks", () => {
    const name = extractFallbackName(
      "<system-reminder>lots of noise here</system-reminder>fix the migration script"
    );
    expect(name).not.toContain("Noise");
    expect(name).toContain("Migration");
  });

  test("strips UUIDs and hex IDs", () => {
    const name = extractFallbackName(
      "fix 550e8400-e29b-41d4-a716-446655440000 deployment issue"
    );
    expect(name).toContain("Deployment");
    expect(name).not.toContain("550e8400");
  });

  test("strips file paths", () => {
    const name = extractFallbackName(
      "update /Users/rico/Development/git/portable-agent-layer/src/hooks/lib/context.ts exports"
    );
    expect(name).toContain("Exports");
    expect(name).not.toContain("Users");
  });

  test("caps at 4 words", () => {
    const name = extractFallbackName(
      "refactor database connection pooling configuration settings module"
    );
    const words = name.split(" ");
    expect(words.length).toBeLessThanOrEqual(4);
  });

  test("Title Cases output", () => {
    const name = extractFallbackName("deploy REDIS cluster CONFIG");
    for (const word of name.split(" ")) {
      expect(word[0]).toBe(word[0].toUpperCase());
      expect(word.slice(1)).toBe(word.slice(1).toLowerCase());
    }
  });
});
