import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// A snapshot is half of a record. These cases are about what happens to the
// half that never gets its pair: the call was denied, or it failed, or it was
// claimed once already.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-pending-"));
  process.env.PAL_HOME = HOME;
  (await import("../src/hooks/lib/settings")).reload();
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

async function lib() {
  return await import("../src/hooks/lib/ledger");
}

const SNAPSHOT = {
  toolUseId: "toolu_01ABC",
  tool: "Edit",
  target: "/work/app/src/index.ts",
  before: "const a = 1;",
  ts: "2026-05-04T10:00:00.000Z",
};

function pendingFiles(): string[] {
  const dir = resolve(HOME, "memory", "ledger", "pending");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("savePending / claimPending", () => {
  test("round-trips the parked before-state", async () => {
    const { savePending, claimPending } = await lib();
    savePending(SNAPSHOT);
    expect(claimPending(SNAPSHOT.toolUseId)).toEqual(SNAPSHOT);
  });

  test("claiming removes it, so a second result cannot reuse the same before", async () => {
    const { savePending, claimPending } = await lib();
    savePending(SNAPSHOT);
    expect(claimPending(SNAPSHOT.toolUseId)).not.toBeNull();
    expect(claimPending(SNAPSHOT.toolUseId)).toBeNull();
    expect(pendingFiles()).toEqual([]);
  });

  test("an unknown id claims nothing rather than throwing", async () => {
    const { claimPending } = await lib();
    expect(claimPending("toolu_never_seen")).toBeNull();
  });

  test("keeps snapshots for different calls apart", async () => {
    const { savePending, claimPending } = await lib();
    savePending(SNAPSHOT);
    savePending({ ...SNAPSHOT, toolUseId: "toolu_02XYZ", before: "other" });
    expect(claimPending("toolu_02XYZ")?.before).toBe("other");
    expect(claimPending(SNAPSHOT.toolUseId)?.before).toBe("const a = 1;");
  });

  test("a null before survives the round trip as null, not as empty text", async () => {
    const { savePending, claimPending } = await lib();
    savePending({ ...SNAPSHOT, before: null });
    expect(claimPending(SNAPSHOT.toolUseId)?.before).toBeNull();
  });

  // The id arrives from another system and becomes a filename.
  test("an id carrying path separators cannot escape the pending directory", async () => {
    const { savePending, claimPending } = await lib();
    savePending({ ...SNAPSHOT, toolUseId: "../../escaped" });
    expect(claimPending("../../escaped")).not.toBeNull();
    expect(existsSync(resolve(HOME, "escaped.json"))).toBe(false);
    expect(existsSync(resolve(HOME, "memory", "escaped.json"))).toBe(false);
  });

  test("a corrupt snapshot is discarded rather than returned", async () => {
    const { savePending, claimPending } = await lib();
    savePending(SNAPSHOT);
    const [name] = pendingFiles();
    writeFileSync(
      resolve(HOME, "memory", "ledger", "pending", name),
      "{not json",
      "utf-8"
    );
    expect(claimPending(SNAPSHOT.toolUseId)).toBeNull();
    expect(pendingFiles()).toEqual([]);
  });
});

describe("reapStalePending", () => {
  test("leaves a fresh snapshot alone — its call may still be running", async () => {
    const { savePending, reapStalePending } = await lib();
    savePending(SNAPSHOT);
    expect(reapStalePending()).toBe(0);
    expect(pendingFiles()).toHaveLength(1);
  });

  test("drops a snapshot nothing claimed, because that action never happened", async () => {
    const { savePending, reapStalePending } = await lib();
    savePending(SNAPSHOT);
    const file = resolve(HOME, "memory", "ledger", "pending", pendingFiles()[0]);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(file, longAgo, longAgo);

    expect(reapStalePending()).toBe(1);
    expect(pendingFiles()).toEqual([]);
  });

  // The horizon matters: too short and a slow tool call loses its before-state
  // while it is still running, too long and abandoned snapshots pile up.
  test("holds a snapshot for most of an hour before giving up on it", async () => {
    const { savePending, reapStalePending } = await lib();
    savePending(SNAPSHOT);
    const file = resolve(HOME, "memory", "ledger", "pending", pendingFiles()[0]);

    const halfAnHourAgo = new Date(Date.now() - 30 * 60 * 1000);
    utimesSync(file, halfAnHourAgo, halfAnHourAgo);
    expect(reapStalePending()).toBe(0);

    const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000);
    utimesSync(file, ninetyMinutesAgo, ninetyMinutesAgo);
    expect(reapStalePending()).toBe(1);
  });

  test("reaps only the stale one when both are present", async () => {
    const { savePending, reapStalePending } = await lib();
    savePending(SNAPSHOT);
    const stale = resolve(HOME, "memory", "ledger", "pending", pendingFiles()[0]);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    savePending({ ...SNAPSHOT, toolUseId: "toolu_fresh" });

    expect(reapStalePending()).toBe(1);
    expect(pendingFiles()).toHaveLength(1);
  });
});
