import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { appendEvent, readTree } from "../src/hooks/lib/work-tree";
import {
  renderNodeDetail,
  renderPromptLine,
  renderSessionContext,
  renderTreeList,
} from "../src/hooks/lib/work-tree-render";
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

function open(node: string, title: string, parent: string | null = null) {
  appendEvent("pal", node, "open", { title, parent }, file, at());
}

const tree = () => readTree("pal", file);

describe("session context", () => {
  test("is empty for a scope with no work, so nothing is injected", () => {
    expect(renderSessionContext(tree())).toBe("");
  });

  test("names the active node, the detour path, parked work and what waits on the user", () => {
    open("a", "Workflow test");
    appendEvent("pal", "a", "stopped", { text: "restore WIP wording" }, file, at());
    open("w", "Pick a wording", null);
    appendEvent("pal", "w", "wait", { on: "Pratt chooses" }, file, at());
    appendEvent("pal", "a", "enter", {}, file, at());
    open("b", "Merge conflict", "a");
    appendEvent("pal", "b", "decide", { text: "keep SJR" }, file, at());
    appendEvent(
      "pal",
      "b",
      "follow-up",
      { text: "installer", due: "2026-10-25" },
      file,
      at()
    );

    const text = renderSessionContext(tree());
    expect(text).toContain("## Work tree — pal");
    expect(text).toContain("Active: Merge conflict [b] — no stopped-at recorded");
    expect(text).toContain("Inside: Workflow test › Merge conflict");
    expect(text).toContain("Decided 2026-10-18: keep SJR");
    expect(text).toContain("- Pick a wording [w]: Pratt chooses");
    expect(text).toContain("- Workflow test [a] — stopped at: restore WIP wording");
    expect(text).toContain("- installer (due 2026-10-25) — on Merge conflict");
    expect(text).toContain("pal cli work");
  });

  test("says when nothing is active", () => {
    open("a", "One");
    appendEvent("pal", "a", "park", { stoppedAt: "x" }, file, at());
    expect(renderSessionContext(tree())).toContain("Active: none");
  });

  test("stays inside its budget however much work there is", () => {
    for (let i = 0; i < 60; i++) {
      open(`n${i}`, `Node ${i} with a fairly long descriptive title`, null);
      appendEvent("pal", `n${i}`, "follow-up", { text: "x".repeat(80) }, file, at());
    }
    expect(renderSessionContext(tree()).length).toBeLessThanOrEqual(2_000);
  });
});

describe("prompt line", () => {
  test("is absent for a scope with no work", () => {
    expect(renderPromptLine(tree(), false)).toBeNull();
  });

  test("carries the active node, its stopped-at and the parked count", () => {
    open("a", "One");
    open("b", "Two", null);
    appendEvent("pal", "b", "stopped", { text: "half way" }, file, at());
    expect(renderPromptLine(tree(), false)).toBe(
      "Work: Two [b] — stopped at: half way · 1 parked"
    );
  });

  test("adds the park-and-open hint on a new topic", () => {
    open("a", "One");
    const line = renderPromptLine(tree(), true) ?? "";
    expect(line.split("\n")).toHaveLength(2);
    expect(line).toContain("pal cli work park --stopped");
  });

  test("says when no node is active", () => {
    open("a", "One");
    appendEvent("pal", "a", "park", {}, file, at());
    expect(renderPromptLine(tree(), false)).toBe("Work: no active node · 1 parked");
  });
});

describe("CLI views", () => {
  test("the tree nests detours and marks each status", () => {
    open("a", "Root");
    open("b", "Detour", "a");
    open("c", "Other", null);
    appendEvent("pal", "c", "done", {}, file, at());
    const list = renderTreeList(tree(), true);
    expect(list).toContain("‖ Root [a]");
    expect(list).toContain("  ‖ Detour [b]");
    expect(list).toContain("✓ Other [c]");
  });

  test("a node's detail lists its decisions with reasons and its artifacts", () => {
    open("a", "One");
    appendEvent(
      "pal",
      "a",
      "decide",
      { text: "keep SJR", why: "main had it" },
      file,
      at()
    );
    appendEvent(
      "pal",
      "a",
      "attach",
      { kind: "pr", ref: "#119", label: "draft" },
      file,
      at()
    );
    const t = tree();
    const detail = renderNodeDetail(t, t.nodes.get("a") ?? (undefined as never));
    expect(detail).toContain("keep SJR (why: main had it)");
    expect(detail).toContain("pr #119 — draft");
  });
});
