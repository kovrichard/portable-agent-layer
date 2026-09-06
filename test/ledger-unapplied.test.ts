import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// What a call that did not land writes to the ledger. This half is the one that
// can still recover a before-state after the fact — nothing landed, so the file
// on disk is still the file the call was about — and that recovery, plus the
// insistence that nothing landed, was until now reachable only by spawning the
// hook.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-unapplied-"));
  process.env.PAL_HOME = HOME;
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/ledger-hook");
}

async function ledger() {
  return await import("../src/hooks/lib/ledger");
}

const CALL = {
  toolUseId: "toolu_01ABC",
  tool: "Edit",
  target: "/work/app/src/index.ts",
};

const SNAPSHOT = { ...CALL, before: "parked", ts: "2026-05-04T10:00:00.000Z" };

function ledgerLines(): Record<string, unknown>[] {
  const file = resolve(HOME, "memory", "ledger", "actions.jsonl");
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function onDisk(contents: string): string {
  const path = resolve(HOME, "target.ts");
  writeFileSync(path, contents, "utf-8");
  return path;
}

describe("unappliedBefore", () => {
  test("prefers the parked snapshot, which is the state the call actually saw", async () => {
    const { unappliedBefore } = await lib();
    expect(unappliedBefore(SNAPSHOT, onDisk("changed since"))).toBe("parked");
  });

  // The recovery that makes this half different from the applied one.
  test("falls back to the file on disk, because nothing landed on it", async () => {
    const { unappliedBefore } = await lib();
    expect(unappliedBefore(null, onDisk("still here"))).toBe("still here");
  });

  test("is null when there is no snapshot and no file — nothing was there", async () => {
    const { unappliedBefore } = await lib();
    expect(unappliedBefore(null, resolve(HOME, "never-existed.ts"))).toBeNull();
  });

  // A snapshot of a file creation parks a null before, and that null is a fact:
  // reading the file now would report the very content the call failed to write.
  test("keeps a snapshot's null rather than reading the file behind it", async () => {
    const { unappliedBefore } = await lib();
    expect(unappliedBefore({ ...SNAPSHOT, before: null }, onDisk("wrote anyway"))).toBe(
      null
    );
  });
});

describe("commitUnapplied", () => {
  test("records the verdict's outcome and reason", async () => {
    const { commitUnapplied } = await lib();
    const entry = commitUnapplied(CALL, { outcome: "denied", reason: "Blocked by rule" });
    expect(entry.outcome).toBe("denied");
    expect(entry.reason).toBe("Blocked by rule");
    expect(entry.tool).toBe("Edit");
  });

  test("carries no reason when the runtime sent none, rather than an empty one", async () => {
    const { commitUnapplied } = await lib();
    const entry = commitUnapplied(CALL, { outcome: "failed" });
    expect("reason" in entry).toBe(false);
  });

  // The whole meaning of the event. An after-state would claim the file changed.
  test("claims nothing landed, and no delta, because nothing did", async () => {
    const { commitUnapplied } = await lib();
    const { savePending } = await ledger();
    savePending(SNAPSHOT);
    const entry = commitUnapplied(CALL, { outcome: "failed", reason: "Exit code 1" });
    expect(entry.after).toBeNull();
    expect("delta" in entry).toBe(false);
  });

  test("takes the before from the parked snapshot when there is one", async () => {
    const { commitUnapplied } = await lib();
    const { savePending } = await ledger();
    savePending({ ...SNAPSHOT, before: "parked contents" });
    expect(commitUnapplied(CALL, { outcome: "failed" }).before).toEqual(
      stateOf("parked contents")
    );
  });

  test("recovers the before from disk when no snapshot was parked", async () => {
    const { commitUnapplied } = await lib();
    const target = onDisk("unchanged by the failed call");
    const entry = commitUnapplied({ ...CALL, target }, { outcome: "denied" });
    expect(entry.before).toEqual(stateOf("unchanged by the failed call"));
  });

  // Without this the record of an attempt exists only while its snapshot does,
  // and the events that reach this hook are exactly the ones most likely to
  // have lost theirs.
  test("writes the entry even with no snapshot and no file to fall back to", async () => {
    const { commitUnapplied } = await lib();
    const entry = commitUnapplied(CALL, { outcome: "denied", reason: "no permission" });
    expect(entry.before).toBeNull();
    expect(ledgerLines()).toHaveLength(1);
  });

  test("claims the snapshot, so a later result cannot record the same before twice", async () => {
    const { commitUnapplied } = await lib();
    const { savePending, claimPending } = await ledger();
    savePending(SNAPSHOT);
    commitUnapplied(CALL, { outcome: "failed" });
    expect(claimPending(CALL.toolUseId)).toBeNull();
  });

  test("appends to the ledger rather than returning an entry it never wrote", async () => {
    const { commitUnapplied } = await lib();
    commitUnapplied(CALL, { outcome: "failed", reason: "Exit code 1" });
    const [row] = ledgerLines();
    expect(row.outcome).toBe("failed");
    expect(row.reason).toBe("Exit code 1");
    expect(row.after).toBeNull();
  });

  test("records one entry per file a patch touched, not one for the call", async () => {
    const { commitUnapplied } = await lib();
    for (const target of ["/work/app/a.ts", "/work/app/b.ts"]) {
      commitUnapplied({ ...CALL, target }, { outcome: "failed" });
    }
    expect(new Set(ledgerLines().map((row) => row.target)).size).toBe(2);
  });
});

function stateOf(content: string): { hash: string; bytes: number } {
  return {
    hash: new Bun.CryptoHasher("sha256").update(content, "utf-8").digest("hex"),
    bytes: Buffer.byteLength(content, "utf-8"),
  };
}
