import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runWork } from "../src/cli/work";
import { readTree } from "../src/hooks/lib/work-tree";
import { freshTestDir } from "./lib/test-home";

let printed: string[];
let logSpy: ReturnType<typeof spyOn> | undefined;
let errSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(() => {
  logSpy?.mockRestore();
  errSpy?.mockRestore();
  process.env.PAL_HOME = freshTestDir(import.meta.file);
  printed = [];
  logSpy = spyOn(console, "log").mockImplementation((...a) => printed.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a) =>
    printed.push(a.join(" "))
  );
});

const work = (...args: string[]) => runWork([...args, "--scope", "demo"]);
const tree = () => readTree("demo");
const output = () => printed.join("\n");

function activeId(): string {
  const id = tree().active;
  if (!id) throw new Error("no active node");
  return id;
}

describe("pal cli work", () => {
  test("open makes a child of the active node unless told otherwise", async () => {
    await work("open", "Workflow", "test");
    const parent = activeId();
    await work("open", "Merge conflict");
    const child = activeId();
    await work("open", "Unrelated", "--root");

    const nodes = tree().nodes;
    expect(nodes.get(parent)?.title).toBe("Workflow test");
    expect(nodes.get(child)?.parent).toBe(parent);
    expect(nodes.get(activeId())?.parent).toBeNull();
  });

  test("open links an ISC and a commitment, and refuses an ISC that is not a number", async () => {
    await work("open", "Work tree", "--isc", "69", "--commitment", "c1");
    expect(tree().nodes.get(activeId())?.links).toEqual({ isc: 69, commitment: "c1" });
    expect(await work("open", "Bad", "--isc", "sixty")).toBe(1);
    expect(output()).toContain('--isc must be an ISC number, got "sixty"');
    expect(tree().nodes.size).toBe(1);
  });

  test("done on a detour says where the parent stopped", async () => {
    await work("open", "Workflow test");
    await work("stopped", "restore", "WIP", "wording");
    await work("open", "Merge conflict");
    printed = [];
    expect(await work("done", "--summary", "resolved")).toBe(0);
    expect(output()).toContain("Back to Workflow test");
    expect(output()).toContain("stopped at: restore WIP wording");
  });

  test("park records the stopped-at and leaves nothing active", async () => {
    await work("open", "One");
    await work("park", "--stopped", "step 3");
    expect(tree().active).toBeNull();
    expect([...tree().nodes.values()][0]?.stoppedAt).toBe("step 3");
  });

  test("enter takes a prefix and reports where the node stopped", async () => {
    await work("open", "One");
    const one = activeId();
    await work("park", "--stopped", "half way");
    await work("open", "Two", "--root");
    const two = activeId();
    const firstDifference = [...one].findIndex((c, i) => c !== two[i]);
    printed = [];
    expect(await work("enter", one.slice(0, firstDifference + 1))).toBe(0);
    expect(tree().active).toBe(one);
    expect(output()).toContain("stopped at: half way");
  });

  test("decide, attach, follow-up and wait land on the active node", async () => {
    await work("open", "One");
    await work("decide", "keep", "SJR", "--why", "main had it");
    await work("attach", "pr", "#119", "--label", "draft");
    await work("follow-up", "installer", "--due", "2026-10-25");
    const id = activeId();
    await work("wait", "Pratt", "picks");
    const node = tree().nodes.get(id);
    expect(node?.decisions[0]).toMatchObject({ text: "keep SJR", why: "main had it" });
    expect(node?.artifacts[0]).toMatchObject({ kind: "pr", ref: "#119", label: "draft" });
    expect(node?.followUps[0]).toMatchObject({ text: "installer", due: "2026-10-25" });
    expect(node?.status).toBe("waiting");
    expect(node?.waitingOn).toBe("Pratt picks");
  });

  test("a write with no active node and no --node fails without recording", async () => {
    expect(await work("decide", "something")).toBe(1);
    expect(output()).toContain("No active node in demo");
    expect(tree().nodes.size).toBe(0);
  });

  test("an unknown node fails with exit 1", async () => {
    await work("open", "One");
    expect(await work("stopped", "x", "--node", "nope")).toBe(1);
    expect(output()).toContain('No single node matches "nope"');
  });

  test("attach refuses an unknown kind", async () => {
    await work("open", "One");
    expect(await work("attach", "bogus", "x")).toBe(1);
    expect(output()).toContain("kind must be one of");
    expect(tree().nodes.get(activeId())?.artifacts).toHaveLength(0);
  });

  test("show with no command prints the active node in full", async () => {
    await work("open", "One");
    await work("stopped", "here");
    printed = [];
    expect(await runWork(["--scope", "demo"])).toBe(0);
    expect(output()).toContain("One [");
    expect(output()).toContain("Stopped at: here");
  });

  test("list hides finished nodes unless --all", async () => {
    await work("open", "Kept");
    await work("open", "Finished", "--root");
    await work("done");
    printed = [];
    await work("list");
    expect(output()).toContain("Kept");
    expect(output()).not.toContain("Finished");
    printed = [];
    await work("list", "--all");
    expect(output()).toContain("✓ Finished");
  });
});
