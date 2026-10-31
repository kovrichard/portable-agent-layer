import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { appendEvent, readTree } from "../src/hooks/lib/progress-tree";
import {
  renderNodeDetail,
  renderPromptLine,
  renderSessionContext,
  renderTreeList,
} from "../src/hooks/lib/progress-tree-render";
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
    expect(text).toContain("## Progress tree — pal");
    expect(text).toContain("Active: Merge conflict [b] — no stopped-at recorded");
    expect(text).toContain("Inside: Workflow test › Merge conflict");
    expect(text).toContain("Decided 2026-10-18: keep SJR");
    expect(text).toContain("- Pick a wording [w]: Pratt chooses");
    expect(text).toContain(
      "- Workflow test [a] (touched 2026-10-18) — stopped at: restore WIP wording"
    );
    expect(text).toContain("- installer (due 2026-10-25) — on Merge conflict");
    expect(text).toContain("pal cli progress");
  });

  test("says when nothing is active", () => {
    open("a", "One");
    appendEvent("pal", "a", "park", { stoppedAt: "x" }, file, at());
    expect(renderSessionContext(tree())).toContain("Active: the project root (pal)");
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
      "Progress: Two [b] — stopped at: half way · 1 parked"
    );
  });

  test("adds the park-and-open hint on a new topic", () => {
    open("a", "One");
    const line = renderPromptLine(tree(), true) ?? "";
    expect(line.split("\n")).toHaveLength(2);
    expect(line).toContain("pal cli progress park --stopped");
  });

  test("parked work is listed newest first, each with the day it was last touched", () => {
    open("a", "Older");
    appendEvent("pal", "a", "park", {}, file, at());
    clock += 2 * 24 * HOUR;
    open("b", "Newer");
    appendEvent("pal", "b", "park", {}, file, at());
    expect(renderSessionContext(tree())).toContain(
      "Parked:\n- Newer [b] (touched 2026-10-20) — no stopped-at recorded\n- Older [a] (touched 2026-10-18) — no stopped-at recorded"
    );
  });

  test("says when no node is active", () => {
    open("a", "One");
    appendEvent("pal", "a", "park", {}, file, at());
    expect(renderPromptLine(tree(), false)).toBe(
      "Progress: pal root — this session has no node yet · 1 parked"
    );
  });

  test("counts the nodes other sessions are working on", () => {
    appendEvent("pal", "a", "open", { title: "One", parent: null }, file, at(), "s1");
    const mine = readTree("pal", file, "s2");
    const now = new Date(clock + HOUR);
    expect(renderPromptLine(mine, false, now)).toBe(
      "Progress: pal root — this session has no node yet · 0 parked · 1 active in other sessions"
    );
    expect(renderSessionContext(mine, now)).toContain(
      "Active in other sessions:\n- One [a] — no stopped-at recorded"
    );
  });

  test("a node held by a session that wrote nothing for 2 hours counts as parked, idle since its last event", () => {
    appendEvent("pal", "a", "open", { title: "One", parent: null }, file, at(), "s1");
    const mine = readTree("pal", file, "s2");
    const now = new Date(clock + 3 * HOUR);
    expect(renderPromptLine(mine, false, now)).toBe(
      "Progress: pal root — this session has no node yet · 1 parked"
    );
    const text = renderSessionContext(mine, now);
    expect(text).not.toContain("Active in other sessions");
    expect(text).toContain("Parked:\n- One [a] (idle since 2026-10-18) — no stopped-at");
    expect(renderTreeList(mine, false, now)).toContain(
      "  ‖ One [a] (idle since 2026-10-18)"
    );
  });
});

const HOUR = 60 * 60 * 1000;

describe("tidying hints", () => {
  test("a node whose PRs all merged with nothing since is listed with the command that closes it", () => {
    open("a", "Rename");
    appendEvent("pal", "a", "attach", { kind: "pr", ref: "#131" }, file, at());
    appendEvent("pal", "a", "park", {}, file, at());
    appendEvent(
      "pal",
      "a",
      "pr-settled",
      { ref: "#131", state: "merged", at: "2026-10-19T15:44:00Z" },
      file,
      at()
    );
    expect(renderSessionContext(tree())).toContain(
      "Done? (every PR merged, nothing recorded since):\n- Rename [a] — #131 merged 2026-10-19; close with pal cli progress done --node a"
    );
    expect(renderTreeList(tree(), false)).toContain("  ✓? Rename [a]");
  });

  test("a node listed under Done? is neither listed nor counted as parked", () => {
    open("a", "Rename");
    appendEvent("pal", "a", "attach", { kind: "pr", ref: "#131" }, file, at());
    appendEvent("pal", "a", "park", {}, file, at());
    appendEvent(
      "pal",
      "a",
      "pr-settled",
      { ref: "#131", state: "merged", at: "2026-10-19T15:44:00Z" },
      file,
      at()
    );
    open("b", "Coach trial");
    appendEvent("pal", "b", "park", {}, file, at());
    const text = renderSessionContext(tree());
    expect(text).toContain("Parked:\n- Coach trial [b]");
    expect(text).not.toMatch(/Parked:[\s\S]*Rename \[a\]/);
    expect(renderPromptLine(tree(), false)).toContain("· 1 parked");
  });

  test("nodes finished in the last 30 days are listed with their ids, so they can be entered again", () => {
    open("a", "Bump klint");
    appendEvent("pal", "a", "done", { summary: "PR #128 merged" }, file, at());
    open("b", "Still going");
    const dayLater = renderSessionContext(tree(), new Date(clock + 24 * HOUR));
    expect(dayLater).toContain(
      "Finished lately (enter one to reopen it):\n- Bump klint [a] — PR #128 merged"
    );
    const monthLater = renderSessionContext(tree(), new Date(clock + 31 * 24 * HOUR));
    expect(monthLater).not.toContain("Finished lately");
  });
});

describe("CLI views", () => {
  test("the tree nests detours and marks each status", () => {
    open("a", "Root");
    open("b", "Detour", "a");
    open("c", "Other", null);
    appendEvent("pal", "c", "done", {}, file, at());
    const list = renderTreeList(tree(), true).split("\n");
    expect(list[0]).toBe("◆ pal");
    expect(list).toContain("  ‖ Root [a] — no stopped-at recorded");
    expect(list).toContain("    ‖ Detour [b] — no stopped-at recorded");
    expect(list).toContain("  ✓ Other [c]");
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
