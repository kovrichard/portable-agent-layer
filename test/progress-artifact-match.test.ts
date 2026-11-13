import { describe, expect, test } from "bun:test";
import { sameArtifact } from "../src/hooks/lib/progress-artifact-match";

function pr(a: string, b: string): boolean {
  return sameArtifact({ kind: "pr", ref: a }, { kind: "pr", ref: b });
}

function commit(a: string, b: string): boolean {
  return sameArtifact({ kind: "commit", ref: a }, { kind: "commit", ref: b });
}

describe("sameArtifact", () => {
  test("artifacts of different kinds never match", () => {
    expect(sameArtifact({ kind: "pr", ref: "12" }, { kind: "commit", ref: "12" })).toBe(
      false
    );
  });

  test("two PR links match only when identical", () => {
    expect(pr("https://h/o/r/pull/5", "https://h/o/r/pull/5")).toBe(true);
    expect(pr("https://h/a/r/pull/5", "https://h/b/r/pull/5")).toBe(false);
  });

  test("only a reference that starts with http:// or https:// counts as a link", () => {
    expect(pr("http://h/a/pull/5", "http://h/b/pull/5")).toBe(false);
    expect(pr("see https://h/a/pull/5", "see https://h/b/pull/5")).toBe(true);
  });

  test("a PR link and a short reference match by trailing number", () => {
    expect(pr("https://h/o/r/pull/15", "#15")).toBe(true);
    expect(pr("#15", "#25")).toBe(false);
    expect(pr("pr-5-fix", "5")).toBe(false);
  });

  test("PR references without a number never match", () => {
    expect(pr("draft", "draft")).toBe(false);
  });

  test("a commit matches its own prefix of at least seven characters, either way round", () => {
    expect(commit("abc1234", "abc1234def")).toBe(true);
    expect(commit("abc1234def", "abc1234")).toBe(true);
    expect(commit("abc12", "abc12ff")).toBe(false);
    expect(commit("abc1234", "abd1234")).toBe(false);
  });

  test("any other kind matches only on an identical reference", () => {
    const url = (ref: string) => ({ kind: "url", ref });
    expect(sameArtifact(url("https://a.example"), url("https://a.example"))).toBe(true);
    expect(sameArtifact(url("https://a.example"), url("https://a.example/b"))).toBe(
      false
    );
  });
});
