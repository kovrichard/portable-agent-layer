import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;
let WORK: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-oc-home-"));
  WORK = mkdtempSync(resolve(tmpdir(), "pal-oc-work-"));
  process.env.PAL_HOME = HOME;
  process.env.PAL_AGENT = "opencode";
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_AGENT;
  rmSync(HOME, { recursive: true, force: true });
  rmSync(WORK, { recursive: true, force: true });
});

async function hook() {
  return await import("../src/hooks/lib/ledger-hook");
}

async function entries() {
  const { ledgerPath } = await import("../src/hooks/lib/ledger");
  return readFileSync(ledgerPath(), "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const call = (tool: string, callID: string, target: string) => ({
  toolUseId: callID,
  tool,
  target,
});

describe("opencode tool names reach the ledger's tool filter", () => {
  test("its lowercase write and edit are recorded", async () => {
    const { ledgeredTarget } = await hook();
    expect(ledgeredTarget("write", { filePath: "/w/a.ts" })).toBe("/w/a.ts");
    expect(ledgeredTarget("edit", { file_path: "/w/a.ts" })).toBe("/w/a.ts");
  });

  test("its read and shell tools are not", async () => {
    const { ledgeredTarget } = await hook();
    for (const tool of ["read", "bash", "shell", "grep", "glob", "list"]) {
      expect(ledgeredTarget(tool, { filePath: "/w/a.ts" })).toBeNull();
    }
  });

  test("patch is left out until its arguments are known to name one file", async () => {
    const { ledgeredTarget } = await hook();
    expect(ledgeredTarget("patch", { filePath: "/w/a.ts" })).toBeNull();
  });
});

describe("callID pairs the two halves the way tool_use_id does", () => {
  test("a modify records both hashes and the change between them", async () => {
    const { snapshotCall, commitApplied } = await hook();
    const target = resolve(WORK, "a.ts");
    writeFileSync(target, "one\n", "utf-8");

    snapshotCall(call("edit", "call_1", target));
    writeFileSync(target, "one\ntwo\n", "utf-8");
    const entry = commitApplied(call("edit", "call_1", target));

    expect(entry?.outcome).toBe("applied");
    expect(entry?.runtime).toBe("opencode");
    expect(entry?.before?.hash).not.toBe(entry?.after?.hash);
    expect(entry?.delta?.hunks).toEqual([{ at: 1, remove: 0, insert: ["two"] }]);
  });

  test("a creation has no before-state rather than an empty one", async () => {
    const { snapshotCall, commitApplied } = await hook();
    const target = resolve(WORK, "new.ts");

    snapshotCall(call("write", "call_2", target));
    writeFileSync(target, "hello\n", "utf-8");
    const entry = commitApplied(call("write", "call_2", target));

    expect(entry?.before).toBeNull();
    expect(entry?.after?.bytes).toBe(6);
  });

  test("a mismatched callID claims nothing, so no entry invents a before-state", async () => {
    const { snapshotCall, commitApplied } = await hook();
    const target = resolve(WORK, "a.ts");
    writeFileSync(target, "one\n", "utf-8");

    snapshotCall(call("edit", "call_3", target));
    expect(commitApplied(call("edit", "call_OTHER", target))).toBeNull();
  });

  test("committing without a snapshot writes nothing at all", async () => {
    const { commitApplied } = await hook();
    const target = resolve(WORK, "a.ts");
    writeFileSync(target, "one\n", "utf-8");

    expect(commitApplied(call("edit", "unsnapshotted", target))).toBeNull();
    await expect(entries()).rejects.toThrow();
  });

  test("a sensitive target is noted but its contents are never kept", async () => {
    const { snapshotCall, commitApplied } = await hook();
    const target = resolve(WORK, ".env");
    writeFileSync(target, "TOKEN=before\n", "utf-8");

    snapshotCall(call("write", "call_4", target));
    writeFileSync(target, "TOKEN=after\n", "utf-8");
    const entry = commitApplied(call("write", "call_4", target));

    expect(entry?.delta).toEqual({ hunks: [], redacted: true });
    expect(JSON.stringify(await entries())).not.toContain("TOKEN=");
  });
});

describe("the opencode plugin wires both halves", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../src/targets/opencode/plugin.ts"),
    "utf-8"
  );

  test("registers tool.execute.after, which nothing else was listening on", () => {
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain('"tool.execute.before"');
  });

  test("snapshots after the security gate, so a blocked call strands nothing", () => {
    expect(source.lastIndexOf("snapshotCall(call)")).toBeGreaterThan(
      source.lastIndexOf("PAL Security:")
    );
  });

  test("declares its agent in-process, needing no shell prefix to survive", () => {
    expect(source).toContain('process.env.PAL_AGENT = "opencode"');
  });
});
