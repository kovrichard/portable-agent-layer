import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The two hooks are only correct together, and only as separate processes:
// the whole point is that the before-state survives from one invocation to the
// next. Driving them in-process would test a pairing that never happens.

const ROOT = resolve(import.meta.dir, "..");
let HOME: string;
let work: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-ledger-hooks-"));
  work = resolve(HOME, "work");
  mkdirSync(work, { recursive: true });
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

function runHook(hook: string, payload: unknown) {
  return spawnSync("bun", ["run", resolve(ROOT, "src", "hooks", `${hook}.ts`)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 20000,
    env: { ...process.env, PAL_HOME: HOME, PAL_AGENT: "claude" },
  });
}

function payload(event: string, target: string, id = "toolu_01ABC") {
  return {
    hook_event_name: event,
    tool_name: "Edit",
    tool_input: { file_path: target },
    tool_use_id: id,
  };
}

function entries(): Record<string, unknown>[] {
  const file = resolve(HOME, "memory", "ledger", "actions.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("the snapshot/commit pair", () => {
  test("records both sides of an edit across two processes", () => {
    const target = resolve(work, "index.ts");
    writeFileSync(target, "const a = 1;", "utf-8");

    runHook("LedgerSnapshot", payload("PreToolUse", target));
    writeFileSync(target, "const a = 2;", "utf-8");
    runHook("LedgerCommit", payload("PostToolUse", target));

    const all = entries();
    expect(all).toHaveLength(1);
    expect((all[0].before as { text: string }).text).toBe("const a = 1;");
    expect((all[0].after as { text: string }).text).toBe("const a = 2;");
    expect(all[0].outcome).toBe("applied");
    expect(all[0].tool).toBe("Edit");
  });

  test("a file that did not exist records before as null", () => {
    const target = resolve(work, "new.ts");

    runHook("LedgerSnapshot", payload("PreToolUse", target));
    writeFileSync(target, "fresh", "utf-8");
    runHook("LedgerCommit", payload("PostToolUse", target));

    const [entry] = entries();
    expect(entry.before).toBeNull();
    expect((entry.after as { text: string }).text).toBe("fresh");
  });

  test("writes nothing at all when the commit half never runs", () => {
    const target = resolve(work, "index.ts");
    writeFileSync(target, "const a = 1;", "utf-8");

    runHook("LedgerSnapshot", payload("PreToolUse", target));

    // A denied call fires the snapshot and never the commit — no action happened,
    // so no entry may claim one did.
    expect(entries()).toEqual([]);
  });

  test("a commit with no matching snapshot records nothing", () => {
    const target = resolve(work, "index.ts");
    writeFileSync(target, "const a = 2;", "utf-8");

    runHook("LedgerCommit", payload("PostToolUse", target, "toolu_unpaired"));

    expect(entries()).toEqual([]);
  });

  test("two concurrent calls keep their own before-states", () => {
    const one = resolve(work, "one.ts");
    const two = resolve(work, "two.ts");
    writeFileSync(one, "ONE-before", "utf-8");
    writeFileSync(two, "TWO-before", "utf-8");

    runHook("LedgerSnapshot", payload("PreToolUse", one, "toolu_one"));
    runHook("LedgerSnapshot", payload("PreToolUse", two, "toolu_two"));
    writeFileSync(one, "ONE-after", "utf-8");
    writeFileSync(two, "TWO-after", "utf-8");
    runHook("LedgerCommit", payload("PostToolUse", two, "toolu_two"));
    runHook("LedgerCommit", payload("PostToolUse", one, "toolu_one"));

    const byTarget = new Map(
      entries().map((e) => [String(e.target), (e.before as { text: string }).text])
    );
    expect(byTarget.get(one)).toBe("ONE-before");
    expect(byTarget.get(two)).toBe("TWO-before");
  });
});

describe("what the ledger declines to record", () => {
  test("a read is a query, not an action", () => {
    const target = resolve(work, "index.ts");
    writeFileSync(target, "const a = 1;", "utf-8");
    const read = {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: target },
      tool_use_id: "toolu_read",
    };

    runHook("LedgerSnapshot", read);
    runHook("LedgerCommit", { ...read, hook_event_name: "PostToolUse" });

    expect(entries()).toEqual([]);
  });

  test("a Bash call, whose effect its arguments do not describe", () => {
    const bash = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hi > /tmp/x" },
      tool_use_id: "toolu_bash",
    };

    runHook("LedgerSnapshot", bash);
    runHook("LedgerCommit", { ...bash, hook_event_name: "PostToolUse" });

    expect(entries()).toEqual([]);
  });
});

describe("hook protocol", () => {
  test("both halves stay silent and exit 0, so neither can disturb a turn", () => {
    const target = resolve(work, "index.ts");
    writeFileSync(target, "const a = 1;", "utf-8");

    const pre = runHook("LedgerSnapshot", payload("PreToolUse", target));
    const post = runHook("LedgerCommit", payload("PostToolUse", target));

    expect(pre.status).toBe(0);
    expect(pre.stdout).toBe("");
    expect(post.status).toBe(0);
    expect(post.stdout).toBe("");
  });

  test("malformed input fails open rather than erroring", () => {
    const res = spawnSync(
      "bun",
      ["run", resolve(ROOT, "src", "hooks", "LedgerSnapshot.ts")],
      {
        input: "not json at all",
        encoding: "utf-8",
        timeout: 20000,
        env: { ...process.env, PAL_HOME: HOME },
      }
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});
