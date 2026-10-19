import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activePath,
  appendEvent,
  buildTree,
  findNode,
  nodesWithStatus,
  readEvents,
  readTree,
  type WorkEvent,
} from "../src/hooks/lib/work-tree";
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

function open(node: string, title: string, parent: string | null = null, scope = "pal") {
  appendEvent(scope, node, "open", { title, parent }, file, at());
}

describe("work tree", () => {
  test("opening a node makes it active and parks the one before", () => {
    open("a", "Lane D wording");
    open("b", "Work tree", null);
    const tree = readTree("pal", file);
    expect(tree.active).toBe("b");
    expect(tree.nodes.get("a")?.status).toBe("parked");
  });

  test("a detour returns to its parent with the parent's stopped-at intact", () => {
    open("a", "Workflow test");
    appendEvent("pal", "a", "stopped", { text: "restore WIP wording" }, file, at());
    open("b", "Merge conflict", "a");
    expect(activePath(readTree("pal", file)).map((n) => n.id)).toEqual(["a", "b"]);

    appendEvent("pal", "b", "done", { summary: "resolved" }, file, at());
    const tree = readTree("pal", file);
    expect(tree.active).toBe("a");
    expect(tree.nodes.get("a")?.stoppedAt).toBe("restore WIP wording");
    expect(tree.nodes.get("b")?.status).toBe("done");
  });

  test("finishing a detour skips ancestors that are already done", () => {
    open("a", "root");
    open("b", "middle", "a");
    open("c", "leaf", "b");
    appendEvent("pal", "b", "done", {}, file, at());
    appendEvent("pal", "c", "enter", {}, file, at());
    appendEvent("pal", "c", "done", {}, file, at());
    expect(readTree("pal", file).active).toBe("a");
  });

  test("finishing a node that is not active leaves the active one alone", () => {
    open("a", "one");
    open("b", "two");
    appendEvent("pal", "a", "done", {}, file, at());
    expect(readTree("pal", file).active).toBe("b");
  });

  test("parking and waiting clear the active node", () => {
    open("a", "one");
    appendEvent("pal", "a", "park", { stoppedAt: "step 3" }, file, at());
    let tree = readTree("pal", file);
    expect(tree.active).toBeNull();
    expect(tree.nodes.get("a")?.stoppedAt).toBe("step 3");

    appendEvent("pal", "a", "enter", {}, file, at());
    appendEvent("pal", "a", "wait", { on: "Pratt picks the wording" }, file, at());
    tree = readTree("pal", file);
    expect(tree.active).toBeNull();
    expect(tree.nodes.get("a")?.status).toBe("waiting");
    expect(tree.nodes.get("a")?.waitingOn).toBe("Pratt picks the wording");
  });

  test("entering a waiting node makes it active and clears what it waited on", () => {
    open("a", "one");
    appendEvent("pal", "a", "wait", { on: "a decision" }, file, at());
    appendEvent("pal", "a", "enter", {}, file, at());
    const node = readTree("pal", file).nodes.get("a");
    expect(node?.status).toBe("active");
    expect(node?.waitingOn).toBeNull();
  });

  test("decisions, artifacts and follow-ups collect on their node", () => {
    open("a", "one");
    appendEvent(
      "pal",
      "a",
      "decide",
      { text: "keep SJR", why: "main had it" },
      file,
      at()
    );
    appendEvent("pal", "a", "attach", { kind: "pr", ref: "#119" }, file, at());
    appendEvent(
      "pal",
      "a",
      "follow-up",
      { text: "installer", due: "2026-10-25" },
      file,
      at()
    );
    const node = readTree("pal", file).nodes.get("a");
    expect(node?.decisions.map((d) => [d.text, d.why])).toEqual([
      ["keep SJR", "main had it"],
    ]);
    expect(node?.artifacts.map((x) => [x.kind, x.ref])).toEqual([["pr", "#119"]]);
    expect(node?.followUps.map((f) => [f.text, f.due])).toEqual([
      ["installer", "2026-10-25"],
    ]);
  });

  test("scopes do not see each other's nodes", () => {
    open("a", "pal work", null, "pal");
    open("b", "harbor work", null, "harbor");
    expect([...readTree("pal", file).nodes.keys()]).toEqual(["a"]);
    expect(readTree("harbor", file).active).toBe("b");
  });

  test("the git cursor is the latest one recorded", () => {
    appendEvent("pal", "", "git-cursor", { branch: "main", head: "aaa" }, file, at());
    appendEvent("pal", "", "git-cursor", { branch: "feat", head: "bbb" }, file, at());
    expect(readTree("pal", file).gitCursor).toEqual({ branch: "feat", head: "bbb" });
  });

  test("events replay in time order, so a merged log reads like one machine's", () => {
    const later: WorkEvent = {
      id: "2",
      ts: "2026-10-18T09:00:00Z",
      scope: "pal",
      node: "a",
      type: "stopped",
      text: "later",
    };
    const earlier: WorkEvent = {
      id: "1",
      ts: "2026-10-18T08:00:00Z",
      scope: "pal",
      node: "a",
      type: "open",
      title: "one",
      parent: null,
    };
    writeFileSync(file, `${JSON.stringify(later)}\n${JSON.stringify(earlier)}\n`);
    expect(readTree("pal", file).nodes.get("a")?.stoppedAt).toBe("later");
  });

  test("an unreadable line is skipped, not fatal", () => {
    open("a", "one");
    appendFileSync(file, "{not json\n");
    expect(readEvents(file)).toHaveLength(1);
  });

  test("a node is found by id or by an unambiguous prefix", () => {
    open("abc123", "one");
    open("abd456", "two");
    const tree = readTree("pal", file);
    expect(findNode(tree, "abc")?.title).toBe("one");
    expect(findNode(tree, "ab")).toBeNull();
    expect(findNode(tree, "zzz")).toBeNull();
  });

  test("nodes with a status come most recently touched first", () => {
    open("a", "one");
    open("b", "two");
    open("c", "three");
    appendEvent("pal", "a", "stopped", { text: "touched" }, file, at());
    expect(
      nodesWithStatus(buildTree("pal", readEvents(file)), "parked").map((n) => n.id)
    ).toEqual(["a", "b"]);
  });
});
