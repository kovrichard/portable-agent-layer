import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activePath,
  appendEvent,
  buildTree,
  findNode,
  nodesWithStatus,
  PROJECT_ROOT,
  readEvents,
  readTree,
  type WorkEvent,
} from "../src/hooks/lib/progress-tree";
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

describe("progress tree", () => {
  test("opening a node makes it active and parks the one before", () => {
    open("a", "Lane D wording");
    open("b", "Progress tree", null);
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

  test("the same PR or commit attached under two spellings is listed once, keeping its label", () => {
    open("a", "one");
    const attach = (artifact: { kind: "pr" | "commit"; ref: string; label?: string }) =>
      appendEvent("pal", "a", "attach", artifact, file, at());
    attach({ kind: "pr", ref: "152" });
    attach({ kind: "pr", ref: "https://github.com/o/r/pull/152" });
    attach({ kind: "pr", ref: "#153" });
    attach({ kind: "commit", ref: "cda2685" });
    attach({ kind: "commit", ref: "cda2685f1e", label: "test: split" });
    attach({ kind: "commit", ref: "0a90e8f" });
    const node = readTree("pal", file).nodes.get("a");
    expect(node?.artifacts.map((x) => [x.kind, x.ref, x.label])).toEqual([
      ["pr", "152", undefined],
      ["pr", "#153", undefined],
      ["commit", "cda2685", "test: split"],
      ["commit", "0a90e8f", undefined],
    ]);
  });

  test("PRs with the same number in two repositories stay apart", () => {
    open("a", "one");
    for (const ref of ["https://github.com/o/a/pull/7", "https://github.com/o/b/pull/7"])
      appendEvent("pal", "a", "attach", { kind: "pr", ref }, file, at());
    expect(readTree("pal", file).nodes.get("a")?.artifacts).toHaveLength(2);
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

  test("the project is the root of every top-level node, so each project is one tree", () => {
    open("a", "one");
    open("b", "two", "a");
    const tree = readTree("pal", file);
    expect(tree.root).toMatchObject({ id: PROJECT_ROOT, title: "pal", parent: null });
    expect(tree.nodes.get("a")?.parent).toBe(PROJECT_ROOT);
    expect(tree.nodes.get("b")?.parent).toBe("a");
    expect(tree.nodes.has(PROJECT_ROOT)).toBe(false);
  });

  describe("parallel sessions", () => {
    const openIn = (session: string, node: string, parent: string | null = null) =>
      appendEvent("pal", node, "open", { title: node, parent }, file, at(), session);
    const view = (session?: string) => readTree("pal", file, session);

    test("each session keeps its own active node", () => {
      openIn("s1", "a");
      openIn("s2", "b");
      expect(view("s1").active).toBe("a");
      expect(view("s2").active).toBe("b");
      expect(view("s1").nodes.get("a")?.status).toBe("active");
    });

    test("a new session starts with no active node", () => {
      openIn("s1", "a");
      expect(view("s3").active).toBeNull();
    });

    test("entering another session's node takes it over", () => {
      openIn("s1", "a");
      openIn("s2", "b");
      appendEvent("pal", "a", "enter", {}, file, at(), "s2");
      expect(view("s2").active).toBe("a");
      expect(view("s1").active).toBeNull();
      expect(view("s2").nodes.get("b")?.status).toBe("parked");
    });

    test("a finished detour does not take back a parent another session holds", () => {
      openIn("s1", "a");
      openIn("s1", "b", "a");
      appendEvent("pal", "a", "enter", {}, file, at(), "s2");
      appendEvent("pal", "b", "done", {}, file, at(), "s1");
      expect(view("s1").active).toBeNull();
      expect(view("s2").active).toBe("a");
    });

    test("a session at the root that records on a parked node wakes it", () => {
      openIn("s1", "a");
      appendEvent("pal", "a", "park", {}, file, at(), "s1");
      appendEvent("pal", "a", "stopped", { text: "back on it" }, file, at(), "s2");
      expect(view("s2").active).toBe("a");
      expect(view("s2").nodes.get("a")?.status).toBe("active");
    });

    test("recording on a parked node does not pull a session off its own node", () => {
      openIn("s1", "a");
      openIn("s1", "b");
      appendEvent("pal", "a", "decide", { text: "noted" }, file, at(), "s1");
      expect(view("s1").active).toBe("b");
      expect(view("s1").nodes.get("a")?.status).toBe("parked");
    });

    test("recording on a node another session holds does not take it over", () => {
      openIn("s1", "a");
      appendEvent("pal", "a", "stopped", { text: "peek" }, file, at(), "s2");
      expect(view("s1").active).toBe("a");
      expect(view("s2").active).toBeNull();
    });

    test("events without a session share one lane, as before", () => {
      openIn("s1", "a");
      openIn("", "b");
      expect(view("").active).toBe("b");
      expect(view("s1").active).toBe("a");
      expect(readEvents(file).at(-1)).not.toHaveProperty("session");
    });
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

  describe("settled PRs", () => {
    const ref = "https://github.com/o/r/pull/126";
    const settle = (stoppedAt?: string) =>
      appendEvent(
        "pal",
        "a",
        "pr-settled",
        {
          ref,
          state: "merged",
          at: "2026-10-19T14:00:00Z",
          ...(stoppedAt ? { stoppedAt } : {}),
        },
        file,
        at()
      );

    test("a settled PR with a line sets the node's stopped-at and remembers the ref", () => {
      open("a", "one");
      settle("PR #126 merged 2026-10-19");
      const tree = readTree("pal", file);
      expect(tree.nodes.get("a")?.stoppedAt).toBe("PR #126 merged 2026-10-19");
      expect(tree.nodes.get("a")?.settledPrs).toEqual([
        { ref, state: "merged", at: "2026-10-19T14:00:00Z" },
      ]);
    });

    test("a settled PR without a line remembers the ref and leaves stopped-at as it was", () => {
      open("a", "one");
      appendEvent("pal", "a", "stopped", { text: "CI running" }, file, at());
      settle();
      const tree = readTree("pal", file);
      expect(tree.nodes.get("a")?.stoppedAt).toBe("CI running");
      expect(tree.nodes.get("a")?.settledPrs.map((pr) => pr.ref)).toEqual([ref]);
    });

    test("a settled PR on a parked node changes nothing but its line", () => {
      open("a", "one");
      open("b", "two");
      const before = readTree("pal", file);
      const updatedBefore = before.nodes.get("a")?.updated;
      settle("PR #126 merged 2026-10-19");
      const after = readTree("pal", file);
      expect(after.nodes.get("a")?.status).toBe("parked");
      expect(after.active).toBe(before.active);
      expect(after.nodes.get("a")?.updated).toBe(updatedBefore);
    });
  });
});
