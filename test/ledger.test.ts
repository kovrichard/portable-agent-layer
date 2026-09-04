import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The ledger is the record something else will be judged against, so these
// cases care less about the happy path than about what an entry claims when it
// cannot tell the whole truth: content too big to keep, a file that did not
// exist before, an action that never landed.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-ledger-"));
  process.env.PAL_HOME = HOME;
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env.PAL_AGENT;
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_SPAWNED_INFERENCE;
  delete process.env.PAL_AGENT;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/ledger");
}

function entries(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const APPLIED = {
  tool: "Edit",
  target: "/work/app/src/index.ts",
  outcome: "applied" as const,
  before: "const a = 1;",
  after: "const a = 2;",
};

describe("recordAction", () => {
  test("stamps who and where from currentAttribution", async () => {
    const { recordAction } = await lib();
    const entry = recordAction(APPLIED);
    expect(entry.machine.length).toBeGreaterThan(0);
    expect(entry.actor.length).toBeGreaterThan(0);
    expect(entry.runtime.length).toBeGreaterThan(0);
    expect(["user", "agent"]).toContain(entry.authority);
  });

  test("records the authority PAL was running under, not a fixed value", async () => {
    process.env.PAL_SPAWNED_INFERENCE = "1";
    const { recordAction } = await lib();
    expect(recordAction(APPLIED).authority).toBe("agent");
  });

  test("appends rather than replacing what is already there", async () => {
    const { recordAction, ledgerPath } = await lib();
    recordAction(APPLIED);
    const first = entries(ledgerPath())[0].id;
    recordAction(APPLIED);
    const all = entries(ledgerPath());
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe(first);
  });

  test("keeps both sides of the change as text while they are small", async () => {
    const { recordAction } = await lib();
    const entry = recordAction(APPLIED);
    expect(entry.before?.text).toBe("const a = 1;");
    expect(entry.after?.text).toBe("const a = 2;");
    expect(entry.before?.truncated).toBeUndefined();
  });

  test("hashes both sides, and different content hashes differently", async () => {
    const { recordAction } = await lib();
    const entry = recordAction(APPLIED);
    expect(entry.before?.hash).toHaveLength(64);
    expect(entry.after?.hash).toHaveLength(64);
    expect(entry.before?.hash).not.toBe(entry.after?.hash);
  });

  test("reports byte length, not character count", async () => {
    const { recordAction } = await lib();
    // Four characters, ten bytes — a ledger that measured length would lie here.
    const entry = recordAction({ ...APPLIED, after: "é☃𝄞" });
    expect(entry.after?.bytes).toBe(Buffer.byteLength("é☃𝄞", "utf-8"));
  });

  test("gives every entry an id, and never the same one twice", async () => {
    const { recordAction } = await lib();
    const ids = [
      recordAction(APPLIED).id,
      recordAction(APPLIED).id,
      recordAction(APPLIED).id,
    ];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  test("keeps text sitting exactly on the inline cap, drops it one byte past", async () => {
    const { recordAction } = await lib();
    const atCap = recordAction({ ...APPLIED, after: "x".repeat(4096) });
    const pastCap = recordAction({ ...APPLIED, after: "x".repeat(4097) });
    expect(atCap.after?.text).toHaveLength(4096);
    expect(atCap.after?.truncated).toBeUndefined();
    expect(pastCap.after?.text).toBeUndefined();
  });

  test("drops oversized text but still hashes and measures it", async () => {
    const { recordAction } = await lib();
    const huge = "x".repeat(5000);
    const entry = recordAction({ ...APPLIED, after: huge });
    expect(entry.after?.text).toBeUndefined();
    expect(entry.after?.truncated).toBe(true);
    expect(entry.after?.bytes).toBe(5000);
    expect(entry.after?.hash).toHaveLength(64);
  });

  test("a file creation records before as null instead of an empty state", async () => {
    const { recordAction } = await lib();
    const entry = recordAction({ ...APPLIED, tool: "Write", before: null });
    expect(entry.before).toBeNull();
    expect(entry.after).not.toBeNull();
  });

  test("distinguishes a creation from a write over an empty file", async () => {
    const { recordAction } = await lib();
    const created = recordAction({ ...APPLIED, before: null });
    const overwritten = recordAction({ ...APPLIED, before: "" });
    expect(created.before).toBeNull();
    expect(overwritten.before?.bytes).toBe(0);
    expect(overwritten.before?.hash).toHaveLength(64);
  });
});

describe("denied actions", () => {
  test("are recorded, because what was attempted is the point of an audit log", async () => {
    const { recordAction, ledgerPath } = await lib();
    recordAction({
      ...APPLIED,
      outcome: "denied",
      after: null,
      reason: "blocked by policy",
    });
    const [entry] = entries(ledgerPath());
    expect(entry.outcome).toBe("denied");
    expect(entry.reason).toBe("blocked by policy");
  });

  test("carry no after state, because nothing landed", async () => {
    const { recordAction } = await lib();
    const entry = recordAction({ ...APPLIED, outcome: "denied", after: null });
    expect(entry.after).toBeNull();
    expect(entry.before).not.toBeNull();
  });

  test("an applied action carries no reason field at all", async () => {
    const { recordAction } = await lib();
    expect("reason" in recordAction(APPLIED)).toBe(false);
  });
});

describe("target paths", () => {
  test("are anchored to the project so they survive a different mount", async () => {
    const root = resolve(HOME, "work", "app");
    mkdirSync(resolve(root, "src"), { recursive: true });
    const { writeProject } = await import("../src/hooks/lib/projects");
    writeProject({
      name: "demo",
      path: root,
      status: "active",
      created: "2026-05-04T10:00:00Z",
      updated: "2026-05-04T10:00:00Z",
    });

    const { recordAction } = await lib();
    const entry = recordAction({ ...APPLIED, target: resolve(root, "src", "index.ts") });
    expect(entry.target).toBe("{proj:demo}/src/index.ts");
  });

  test("pass through unchanged outside any registered project", async () => {
    const { recordAction } = await lib();
    expect(recordAction(APPLIED).target).toBe("/work/app/src/index.ts");
  });
});

describe("rotation", () => {
  test("leaves the active file alone below the cap", async () => {
    const { recordAction, ledgerPath } = await lib();
    recordAction(APPLIED);
    recordAction(APPLIED);
    expect(readdirSync(resolve(HOME, "memory", "ledger"))).toEqual(["actions.jsonl"]);
    expect(entries(ledgerPath())).toHaveLength(2);
  });

  // The cap is the point at which the file has become big enough to set aside,
  // so reaching it is enough — waiting for one more byte would leave the
  // boundary undefined.
  test("rotates a file sitting exactly on the cap, but not one byte under", async () => {
    const { recordAction, ledgerPath } = await lib();
    const dir = resolve(HOME, "memory", "ledger");

    writeFileSync(ledgerPath(), "x".repeat(4 * 1024 * 1024 - 1), "utf-8");
    recordAction(APPLIED);
    expect(readdirSync(dir)).toEqual(["actions.jsonl"]);

    writeFileSync(ledgerPath(), "x".repeat(4 * 1024 * 1024), "utf-8");
    recordAction(APPLIED);
    expect(readdirSync(dir).filter((f) => f !== "actions.jsonl")).toHaveLength(1);
  });

  test("moves the full file aside and starts a fresh one", async () => {
    const { recordAction, ledgerPath } = await lib();
    recordAction(APPLIED);
    writeFileSync(ledgerPath(), "x".repeat(4 * 1024 * 1024 + 1), "utf-8");
    recordAction(APPLIED);

    const files = readdirSync(resolve(HOME, "memory", "ledger")).sort();
    expect(files).toHaveLength(2);
    expect(files).toContain("actions.jsonl");
    expect(files.some((f) => /^actions-.+\.jsonl$/.test(f))).toBe(true);
  });

  test("loses nothing — the rotated file keeps its content", async () => {
    const { recordAction, ledgerPath } = await lib();
    const marker = `${"y".repeat(4 * 1024 * 1024)}\nKEEP-ME\n`;
    writeFileSync(ledgerPath(), marker, "utf-8");
    recordAction(APPLIED);

    const dir = resolve(HOME, "memory", "ledger");
    const rotated = readdirSync(dir).find((f) => f !== "actions.jsonl");
    expect(rotated).toBeDefined();
    expect(readFileSync(resolve(dir, rotated as string), "utf-8")).toContain("KEEP-ME");
  });

  test("the fresh file holds only the entry that triggered the rotation", async () => {
    const { recordAction, ledgerPath } = await lib();
    writeFileSync(ledgerPath(), "z".repeat(4 * 1024 * 1024 + 1), "utf-8");
    const entry = recordAction(APPLIED);
    const after = entries(ledgerPath());
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(entry.id);
  });

  // Each archive is named for the moment it was rotated. The clock is frozen
  // here so both rotations agree on that moment — the collision the naming has
  // to survive, forced rather than waited for.
  test("a second rotation in the same instant archives beside the first, not over it", async () => {
    setSystemTime(new Date("2026-05-04T10:00:00.000Z"));
    try {
      const { recordAction, ledgerPath } = await lib();
      const dir = resolve(HOME, "memory", "ledger");
      const fill = (marker: string) =>
        writeFileSync(
          ledgerPath(),
          `${"x".repeat(4 * 1024 * 1024)}\n${marker}\n`,
          "utf-8"
        );

      fill("FIRST");
      recordAction(APPLIED);
      fill("SECOND");
      recordAction(APPLIED);

      const archives = readdirSync(dir)
        .filter((f) => f !== "actions.jsonl")
        .sort();
      expect(archives).toEqual([
        "actions-2026-05-04T10-00-00-000Z-1.jsonl",
        "actions-2026-05-04T10-00-00-000Z.jsonl",
      ]);
      const contents = archives.map((f) => readFileSync(resolve(dir, f), "utf-8"));
      expect(contents.some((c) => c.includes("FIRST"))).toBe(true);
      expect(contents.some((c) => c.includes("SECOND"))).toBe(true);
    } finally {
      setSystemTime();
    }
  });

  test("creates the ledger directory on first use", async () => {
    expect(existsSync(resolve(HOME, "memory", "ledger"))).toBe(false);
    const { recordAction } = await lib();
    recordAction(APPLIED);
    expect(existsSync(resolve(HOME, "memory", "ledger", "actions.jsonl"))).toBe(true);
  });
});
