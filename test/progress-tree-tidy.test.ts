import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { appendEvent, readTree } from "../src/hooks/lib/progress-tree";
import { mergedButOpen, similarNodes } from "../src/hooks/lib/progress-tree-tidy";
import { freshTestDir } from "./lib/test-home";

let file: string;
let clock: number;

beforeEach(() => {
  file = resolve(freshTestDir(import.meta.file), "events.jsonl");
  clock = Date.parse("2026-10-18T08:00:00Z");
});

function at(): Date {
  clock += 1000;
  return new Date(clock);
}

function open(node: string, title = node) {
  appendEvent("pal", node, "open", { title, parent: null }, file, at());
}

function attachPr(node: string, n: number) {
  appendEvent("pal", node, "attach", { kind: "pr", ref: `#${n}` }, file, at());
}

function settle(node: string, n: number, state: "merged" | "closed", when: string) {
  appendEvent("pal", node, "pr-settled", { ref: `#${n}`, state, at: when }, file, at());
}

const tree = () => readTree("pal", file);
const flaggedIds = () => mergedButOpen(tree()).map(({ node }) => node.id);

describe("a node whose PRs have all merged and that saw nothing since", () => {
  test("is flagged, naming the PR that merged last", () => {
    open("a");
    attachPr("a", 131);
    attachPr("a", 132);
    settle("a", 132, "merged", "2026-10-19T14:00:00Z");
    settle("a", 131, "merged", "2026-10-19T15:44:00Z");
    const flagged = mergedButOpen(tree());
    expect(flagged.map(({ node }) => node.id)).toEqual(["a"]);
    expect(flagged[0]?.lastMerge).toEqual({
      ref: "#131",
      state: "merged",
      at: "2026-10-19T15:44:00Z",
    });
  });

  test("is not flagged while one of its PRs is still open", () => {
    open("a");
    attachPr("a", 131);
    attachPr("a", 132);
    settle("a", 131, "merged", "2026-10-19T15:44:00Z");
    expect(flaggedIds()).toEqual([]);
  });

  test("is not flagged when a PR closed without merging", () => {
    open("a");
    attachPr("a", 131);
    settle("a", 131, "closed", "2026-10-19T15:44:00Z");
    expect(flaggedIds()).toEqual([]);
  });

  test("is not flagged once anything was recorded on it after the merge", () => {
    open("a");
    attachPr("a", 131);
    settle("a", 131, "merged", "2026-10-18T08:00:03Z");
    appendEvent("pal", "a", "stopped", { text: "next: phase 2" }, file, at());
    expect(flaggedIds()).toEqual([]);
  });

  test("is not flagged once a new PR is attached", () => {
    open("a");
    attachPr("a", 131);
    settle("a", 131, "merged", "2026-10-19T15:44:00Z");
    attachPr("a", 140);
    expect(flaggedIds()).toEqual([]);
  });

  test("a finished node or one without PRs is never flagged", () => {
    open("a");
    attachPr("a", 131);
    settle("a", 131, "merged", "2026-10-19T15:44:00Z");
    appendEvent("pal", "a", "done", {}, file, new Date("2026-10-19T15:00:00Z"));
    open("b");
    expect(flaggedIds()).toEqual([]);
  });
});

describe("a new title that shares most of its words with a node", () => {
  const similarIds = (title: string, now = new Date("2026-10-21T08:00:00Z")) =>
    similarNodes(tree(), title, now).map((node) => node.id);

  test("matches a reworded title, ignoring case, punctuation and filler words", () => {
    open("a", "Rename work tree to progress tree");
    open("b", "Fix btoa in build.js");
    expect(similarIds("Rename Work-Tree: Progress")).toEqual(["a"]);
  });

  test("words most titles in the scope use do not make two titles alike", () => {
    open("a", "Progress tree: Haiku decision labeller");
    open("b", "Progress tree: one active node per session");
    open("c", "Progress tree: project as root node");
    open("d", "Rename work tree to progress tree");
    expect(similarIds("Rename the progress tree")).toEqual(["d"]);
  });

  test("one shared word is not enough", () => {
    open("a", "Spec: merged PR updates its progress-tree node");
    expect(similarIds("Bump klint and reinstall its tree")).toEqual([]);
  });

  test("matches a node finished in the last 30 days, not one finished before", () => {
    open("recent", "Coach trial schema fix");
    appendEvent("pal", "recent", "done", {}, file, new Date("2026-11-20T08:00:00Z"));
    open("old", "Coach trial schema rewrite");
    appendEvent("pal", "old", "done", {}, file, new Date("2026-10-19T08:00:00Z"));
    expect(
      similarIds("Coach trial: schema fix again", new Date("2026-12-01T08:00:00Z"))
    ).toEqual(["recent"]);
  });
});
