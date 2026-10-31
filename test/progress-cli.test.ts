import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProgress } from "../src/cli/progress";
import { PROJECT_ROOT, readTree } from "../src/hooks/lib/progress-tree";
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

const progress = (...args: string[]) => runProgress([...args, "--scope", "demo"]);
const tree = () => readTree("demo");
const output = () => printed.join("\n");

function activeId(): string {
  const id = tree().active;
  if (!id) throw new Error("no active node");
  return id;
}

describe("pal cli progress", () => {
  test("open makes a child of the active node unless told otherwise", async () => {
    await progress("open", "Workflow", "test");
    const parent = activeId();
    await progress("open", "Merge conflict");
    const child = activeId();
    await progress("open", "Unrelated", "--root");

    const nodes = tree().nodes;
    expect(nodes.get(parent)?.title).toBe("Workflow test");
    expect(nodes.get(child)?.parent).toBe(parent);
    expect(nodes.get(activeId())?.parent).toBe(PROJECT_ROOT);
  });

  test("open links an ISC and a commitment, and refuses an ISC that is not a number", async () => {
    await progress("open", "Progress tree", "--isc", "69", "--commitment", "c1");
    expect(tree().nodes.get(activeId())?.links).toEqual({ isc: 69, commitment: "c1" });
    expect(await progress("open", "Bad", "--isc", "sixty")).toBe(1);
    expect(output()).toContain('--isc must be an ISC number, got "sixty"');
    expect(tree().nodes.size).toBe(1);
  });

  test("open refuses a title most of whose words a node already has, names it, and --new opens anyway", async () => {
    await progress("open", "Rename work tree to progress tree");
    const existing = activeId();
    await progress("park", "--stopped", "PR open");
    printed = [];

    expect(await progress("open", "Rename Work Tree Progress")).toBe(1);
    expect(output()).toContain(
      `Rename work tree to progress tree [${existing}] (parked)`
    );
    expect(output()).toContain(`pal cli progress enter ${existing}`);
    expect(tree().nodes.size).toBe(1);

    expect(await progress("open", "Rename Work Tree Progress", "--new")).toBe(0);
    expect(tree().nodes.size).toBe(2);
  });

  test("done on a detour says where the parent stopped", async () => {
    await progress("open", "Workflow test");
    await progress("stopped", "restore", "WIP", "wording");
    await progress("open", "Merge conflict");
    printed = [];
    expect(await progress("done", "--summary", "resolved")).toBe(0);
    expect(output()).toContain("Back to Workflow test");
    expect(output()).toContain("stopped at: restore WIP wording");
  });

  test("park records the stopped-at and leaves nothing active", async () => {
    await progress("open", "One");
    await progress("park", "--stopped", "step 3");
    expect(tree().active).toBeNull();
    expect([...tree().nodes.values()][0]?.stoppedAt).toBe("step 3");
  });

  test("enter takes a prefix and reports where the node stopped", async () => {
    await progress("open", "One");
    const one = activeId();
    await progress("park", "--stopped", "half way");
    await progress("open", "Two", "--root");
    const two = activeId();
    const firstDifference = [...one].findIndex((c, i) => c !== two[i]);
    printed = [];
    expect(await progress("enter", one.slice(0, firstDifference + 1))).toBe(0);
    expect(tree().active).toBe(one);
    expect(output()).toContain("stopped at: half way");
  });

  test("decide, attach, follow-up and wait land on the active node", async () => {
    await progress("open", "One");
    await progress("decide", "keep", "SJR", "--why", "main had it");
    await progress("attach", "pr", "#119", "--label", "draft");
    await progress("follow-up", "installer", "--due", "2026-10-25");
    const id = activeId();
    await progress("wait", "Pratt", "picks");
    const node = tree().nodes.get(id);
    expect(node?.decisions[0]).toMatchObject({ text: "keep SJR", why: "main had it" });
    expect(node?.artifacts[0]).toMatchObject({ kind: "pr", ref: "#119", label: "draft" });
    expect(node?.followUps[0]).toMatchObject({ text: "installer", due: "2026-10-25" });
    expect(node?.status).toBe("waiting");
    expect(node?.waitingOn).toBe("Pratt picks");
  });

  test("a record from the project root opens the session's node and lands there", async () => {
    expect(await progress("decide", "something")).toBe(0);
    const node = tree().nodes.get(activeId());
    expect(node?.parent).toBe(PROJECT_ROOT);
    expect(node?.title).toStartWith("Session ");
    expect(node?.decisions.map((d) => d.text)).toEqual(["something"]);
  });

  test("park and done with no active node still fail without recording", async () => {
    expect(await progress("park")).toBe(1);
    expect(output()).toContain("No active node in demo");
    expect(tree().nodes.size).toBe(0);
  });

  test("an unknown node fails with exit 1", async () => {
    await progress("open", "One");
    expect(await progress("stopped", "x", "--node", "nope")).toBe(1);
    expect(output()).toContain('No single node matches "nope"');
  });

  test("attach refuses an unknown kind", async () => {
    await progress("open", "One");
    expect(await progress("attach", "bogus", "x")).toBe(1);
    expect(output()).toContain("kind must be one of");
    expect(tree().nodes.get(activeId())?.artifacts).toHaveLength(0);
  });

  test("show with no command prints the active node in full", async () => {
    await progress("open", "One");
    await progress("stopped", "here");
    printed = [];
    expect(await runProgress(["--scope", "demo"])).toBe(0);
    expect(output()).toContain("One [");
    expect(output()).toContain("Stopped at: here");
  });

  test("list hides finished nodes unless --all", async () => {
    await progress("open", "Kept");
    await progress("open", "Finished", "--root");
    await progress("done");
    printed = [];
    await progress("list");
    expect(output()).toContain("Kept");
    expect(output()).not.toContain("Finished");
    printed = [];
    await progress("list", "--all");
    expect(output()).toContain("✓ Finished");
  });

  test("a tree recorded before the rename still shows", async () => {
    const dataFolder = resolve(process.env.PAL_HOME as string, "memory", "progress-tree");
    mkdirSync(dataFolder, { recursive: true });
    writeFileSync(
      resolve(dataFolder, "events.jsonl"),
      '{"id":"old01","ts":"2026-10-18T10:00:00.000Z","scope":"demo","node":"legacy1","type":"open","title":"Legacy node","parent":null}\n'
    );
    expect(await progress("show", "--node", "legacy1")).toBe(0);
    expect(output()).toContain("Legacy node");
  });
});
