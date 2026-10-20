import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { appendEvent, readEvents, readTree } from "../src/hooks/lib/progress-tree";
import {
  type GhRunner,
  ghPrView,
  settleAttachedPrs,
} from "../src/hooks/lib/progress-tree-prs";
import { freshTestDir } from "./lib/test-home";

const MERGED = {
  state: "MERGED",
  mergedAt: "2026-10-19T14:00:00Z",
  closedAt: "2026-10-19T14:00:00Z",
};
const CLOSED = { state: "CLOSED", mergedAt: null, closedAt: "2026-10-18T08:30:00Z" };
const OPEN = { state: "OPEN", mergedAt: null, closedAt: null };
const NOW = new Date("2026-10-19T16:00:00Z");

let dir: string;
let file: string;
let clock: number;

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
  file = resolve(dir, "events.jsonl");
  clock = Date.parse("2026-10-18T08:00:00Z");
});

function at(): Date {
  clock += 1000;
  return new Date(clock);
}

function prRef(n: number): string {
  return `https://github.com/o/r/pull/${n}`;
}

function open(node: string, parent: string | null = null) {
  appendEvent("pal", node, "open", { title: node, parent }, file, at());
}

function attach(node: string, n: number) {
  appendEvent("pal", node, "attach", { kind: "pr", ref: prRef(n) }, file, at());
}

function fakeGh(replies: Record<string, object | null>, calls: string[] = []): GhRunner {
  return (ref) => {
    calls.push(ref);
    const reply = replies[ref] ?? null;
    return reply ? JSON.stringify(reply) : null;
  };
}

function settle(
  gh: GhRunner,
  options: { now?: Date; budgetMs?: number; clock?: () => number } = {}
) {
  settleAttachedPrs("pal", dir, { file, gh, now: NOW, ...options });
}

function stoppedAtOf(node: string): string | null {
  return readTree("pal", file).nodes.get(node)?.stoppedAt ?? null;
}

describe("a merged or closed PR writes its node's stopped-at line", () => {
  test("merged: 'PR #n merged <date>'", () => {
    open("a");
    attach("a", 126);
    settle(fakeGh({ [prRef(126)]: MERGED }));
    expect(stoppedAtOf("a")).toBe("PR #126 merged 2026-10-19");
  });

  test("closed without merging: 'PR #n closed without merging <date>'", () => {
    open("a");
    attach("a", 126);
    settle(fakeGh({ [prRef(126)]: CLOSED }));
    expect(stoppedAtOf("a")).toBe("PR #126 closed without merging 2026-10-18");
  });

  test("open: no event is written and stopped-at is unchanged", () => {
    open("a");
    attach("a", 126);
    appendEvent("pal", "a", "stopped", { text: "CI running" }, file, at());
    const before = readEvents(file).length;
    settle(fakeGh({ [prRef(126)]: OPEN }));
    expect(readEvents(file)).toHaveLength(before);
    expect(stoppedAtOf("a")).toBe("CI running");
  });

  test("only the PR attached last is asked about", () => {
    open("a");
    attach("a", 126);
    attach("a", 133);
    const calls: string[] = [];
    const before = readEvents(file).length;
    settle(fakeGh({ [prRef(126)]: MERGED, [prRef(133)]: OPEN }, calls));
    expect(calls).toEqual([prRef(133)]);
    expect(readEvents(file)).toHaveLength(before);
  });

  test("the line names the latest PR when it is merged and the earlier one closed", () => {
    open("a");
    attach("a", 126);
    attach("a", 133);
    settle(fakeGh({ [prRef(126)]: CLOSED, [prRef(133)]: MERGED }));
    expect(stoppedAtOf("a")).toBe("PR #133 merged 2026-10-19");
  });

  test("a stopped-at line written after the merge is kept, but the ref is still settled", () => {
    open("a");
    attach("a", 126);
    appendEvent(
      "pal",
      "a",
      "stopped",
      { text: "follow up" },
      file,
      new Date("2026-10-19T15:00:00Z")
    );
    settle(fakeGh({ [prRef(126)]: MERGED }));
    expect(stoppedAtOf("a")).toBe("follow up");
    expect(readTree("pal", file).settledPrs.has(prRef(126))).toBe(true);
  });

  test("a stopped-at line written before the merge is overwritten", () => {
    open("a");
    attach("a", 126);
    appendEvent(
      "pal",
      "a",
      "stopped",
      { text: "old" },
      file,
      new Date("2026-10-19T13:00:00Z")
    );
    settle(fakeGh({ [prRef(126)]: MERGED }));
    expect(stoppedAtOf("a")).toBe("PR #126 merged 2026-10-19");
  });
});

describe("a settled PR is not asked about again, an open one is", () => {
  test("a merged PR is asked about once", () => {
    open("a");
    attach("a", 126);
    settle(fakeGh({ [prRef(126)]: MERGED }));
    const calls: string[] = [];
    settle(fakeGh({ [prRef(126)]: MERGED }, calls));
    expect(calls).toEqual([]);
  });

  test("an open PR is asked about at every start", () => {
    open("a");
    attach("a", 126);
    const calls: string[] = [];
    settle(fakeGh({ [prRef(126)]: OPEN }, calls));
    settle(fakeGh({ [prRef(126)]: OPEN }, calls));
    expect(calls).toHaveLength(2);
  });

  test("a done node is not asked about", () => {
    open("a");
    attach("a", 126);
    appendEvent("pal", "a", "done", {}, file, at());
    const calls: string[] = [];
    settle(fakeGh({ [prRef(126)]: MERGED }, calls));
    expect(calls).toEqual([]);
  });
});

describe("gh failing never fails the session and writes nothing", () => {
  test.each([
    ["no reply", () => null],
    ["unparseable reply", () => "not json"],
    [
      "a thrown error",
      (): string | null => {
        throw new Error("gh exploded");
      },
    ],
  ])("%s", (_, gh) => {
    open("a");
    attach("a", 126);
    const before = readEvents(file).length;
    expect(() => settle(gh)).not.toThrow();
    expect(readEvents(file)).toHaveLength(before);
  });

  test("a missing gh binary gives no reply", () => {
    expect(ghPrView(prRef(126), dir, 1000, "pal-no-such-gh-binary")).toBeNull();
  });
});

describe("the gh calls share one time budget", () => {
  test("a call starts only while budget remains, and unchecked PRs wait for the next start", () => {
    open("a");
    attach("a", 1);
    open("b");
    attach("b", 2);
    open("c");
    attach("c", 3);
    let elapsed = 0;
    const timeouts: number[] = [];
    const calls: string[] = [];
    const slowGh: GhRunner = (ref, _cwd, timeoutMs) => {
      calls.push(ref);
      timeouts.push(timeoutMs);
      elapsed += 2000;
      return JSON.stringify(MERGED);
    };
    settle(slowGh, { budgetMs: 3000, clock: () => elapsed });
    expect(calls).toHaveLength(2);
    expect(timeouts).toEqual([3000, 1000]);

    const nextStart: string[] = [];
    settle(fakeGh({ [prRef(3)]: MERGED }, nextStart));
    expect(nextStart).toEqual([prRef(3)]);
    expect(stoppedAtOf("c")).toBe("PR #3 merged 2026-10-19");
  });
});

describe("what the settling does not touch", () => {
  test("a merged write leaves status, parent and the active node as they were", () => {
    open("a");
    attach("a", 126);
    open("b", "a");
    const before = readTree("pal", file);
    settle(fakeGh({ [prRef(126)]: MERGED }));
    const after = readTree("pal", file);
    expect(after.nodes.get("a")?.status).toBe(before.nodes.get("a")?.status);
    expect(after.nodes.get("b")?.parent).toBe(before.nodes.get("b")?.parent);
    expect(after.active).toBe(before.active);
  });
});
