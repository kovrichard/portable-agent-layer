import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describeMoves, hashTotal } from "../src/cli/migrations/move-manifest";
import {
  type MoveSeams,
  moveRefusal,
  moveVerified,
  previewMoves,
  undoVerifiedMove,
} from "../src/cli/migrations/verified-move";
import {
  manifestsIn,
  memoryMoveDetails,
  memoryMoveEvents,
  writeFile,
} from "./lib/memory-move-fixture";
import { freshTestDir } from "./lib/test-home";

let HOME: string;
const at = (...parts: string[]) => resolve(HOME, ...parts);

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
});

function seedStores() {
  writeFile(at("memory", "learning", "notes.md"), "first");
  writeFile(at("memory", "learning", "deep", "data.jsonl"), '{"x":1}\n');
  writeFile(at("memory", "state", "sessions.json"), "{}");

  return [
    { from: at("memory", "learning"), to: at("memory", "silver", "learning") },
    {
      from: at("memory", "state", "sessions.json"),
      to: at("memory", "gold", "sessions.json"),
    },
  ];
}

const realSeams: MoveSeams = {
  rename: renameSync,
  deviceOf: (path) => statSync(path).dev,
};

const read = (...parts: string[]) => readFileSync(at(...parts), "utf-8");

function expectUntouched(): void {
  expect(read("memory", "learning", "notes.md")).toBe("first");
  expect(read("memory", "learning", "deep", "data.jsonl")).toBe('{"x":1}\n');
  expect(read("memory", "state", "sessions.json")).toBe("{}");
  expect(existsSync(at("memory", "silver"))).toBe(false);
  expect(existsSync(at("memory", "gold", "sessions.json"))).toBe(false);
}

describe("moveVerified: moving", () => {
  test("renames a folder and a file onto their targets, creating the parents", () => {
    const moves = seedStores();

    const report = moveVerified("layout", moves);

    expect(report).toMatchObject({ outcome: "moved", files: 3 });
    expect(read("memory", "silver", "learning", "deep", "data.jsonl")).toBe('{"x":1}\n');
    expect(read("memory", "gold", "sessions.json")).toBe("{}");
    expect(existsSync(at("memory", "learning"))).toBe(false);
    expect(existsSync(at("memory", "state", "sessions.json"))).toBe(false);
  });

  test("writes a stamped manifest with one hashed line per file", () => {
    const moves = seedStores();

    const report = moveVerified("layout", moves);

    const [manifest] = manifestsIn(HOME);
    expect(manifest).toMatch(
      /^layout-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.manifest\.jsonl$/
    );
    expect(report.manifest).toBe(at("backups", manifest));
    const lines = read("backups", manifest)
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({
        from: moves[0].from,
        to: moves[0].to,
        file: "notes.md",
        size: 5,
      }),
      expect.objectContaining({ file: join("deep", "data.jsonl"), size: 8 }),
      expect.objectContaining({
        from: moves[1].from,
        to: moves[1].to,
        file: "",
        size: 2,
      }),
    ]);
    expect(lines[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("records the move with its counts, byte total and hash total", () => {
    const moves = seedStores();
    const total = hashTotal(describeMoves(moves));

    const report = moveVerified("layout", moves);

    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        migration: "layout",
        outcome: "moved",
        entries: 2,
        files: 3,
        bytes: 5 + 8 + 2,
        hashTotal: total,
        manifest: manifestsIn(HOME)[0],
        actor: expect.any(String),
      }),
    ]);
    expect(report.manifest).not.toBeNull();
  });

  test("the dry run is exactly the manifest the move then writes, and changes nothing", () => {
    const moves = seedStores();

    const preview = previewMoves(moves);

    expectUntouched();
    expect(manifestsIn(HOME)).toEqual([]);
    expect(memoryMoveEvents(HOME)).toEqual([]);
    moveVerified("layout", moves);
    expect(read("backups", manifestsIn(HOME)[0])).toBe(preview);
  });
});

describe("moveVerified: refusing", () => {
  test("refuses when a target already exists, and moves nothing", () => {
    const moves = seedStores();
    writeFile(at("memory", "gold", "sessions.json"), "taken");

    const report = moveVerified("layout", moves);

    expect(report).toEqual({
      outcome: "refused",
      files: 0,
      manifest: null,
      reason: "target exists",
    });
    expect(read("memory", "learning", "notes.md")).toBe("first");
    expect(read("memory", "gold", "sessions.json")).toBe("taken");
    expect(manifestsIn(HOME)).toEqual([]);
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({ outcome: "refused", reason: "target exists" }),
    ]);
    expect(memoryMoveDetails(HOME)).toEqual([
      expect.objectContaining({ from: moves[1].from, to: moves[1].to }),
    ]);
  });

  test("refuses when source and target are on different filesystems", () => {
    const moves = seedStores();
    const elsewhere: MoveSeams = {
      ...realSeams,
      deviceOf: (path) => (path.includes("silver") || path === at("memory") ? 2 : 1),
    };

    expect(moveRefusal(moves, elsewhere)).toEqual({
      reason: "different filesystems",
      move: moves[0],
    });
    expect(moveVerified("layout", moves, elsewhere).reason).toBe("different filesystems");
    expectUntouched();
    expect(manifestsIn(HOME)).toEqual([]);
  });

  test("compares the source with the nearest folder of the target that exists", () => {
    const moves = seedStores();
    const asked: string[] = [];
    const seams: MoveSeams = {
      ...realSeams,
      deviceOf: (path) => {
        asked.push(path);

        return 1;
      },
    };

    expect(moveRefusal(moves, seams)).toBeNull();
    expect(asked.slice(0, 2)).toEqual([moves[0].from, at("memory")]);
  });

  test("refuses when a source is missing", () => {
    const moves = seedStores();
    const missing = { from: at("memory", "gone"), to: at("memory", "silver", "gone") };

    expect(moveVerified("layout", [...moves, missing]).reason).toBe("source missing");
    expectUntouched();
  });

  test("moves nothing at all for an empty list, and says so in a moved event", () => {
    expect(moveVerified("layout", [])).toMatchObject({ outcome: "moved", files: 0 });
  });
});

describe("moveVerified: rolling back", () => {
  test("renames the moves already done back when a later rename fails", () => {
    const moves = seedStores();
    let calls = 0;
    const failsSecond: MoveSeams = {
      ...realSeams,
      rename: (from, to) => {
        calls += 1;
        if (calls === 2) throw new Error("EACCES");
        renameSync(from, to);
      },
    };

    const report = moveVerified("layout", moves, failsSecond);

    expect(report).toMatchObject({
      outcome: "rolled-back",
      files: 0,
      reason: "rename failed",
    });
    expect(read("memory", "learning", "notes.md")).toBe("first");
    expect(existsSync(at("memory", "silver"))).toBe(false);
    expect(memoryMoveEvents(HOME)).toEqual([
      expect.objectContaining({
        outcome: "rolled-back",
        entries: 1,
        reason: "rename failed",
        manifest: manifestsIn(HOME)[0],
      }),
    ]);
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({
      detail: ["Error: EACCES"],
      stuck: [],
    });
  });

  test("renames everything back, the failing move too, when a moved file's hash differs", () => {
    const moves = seedStores();
    const writerDuringMove: MoveSeams = {
      ...realSeams,
      rename: (from, to) => {
        renameSync(from, to);

        if (to === moves[1].to) appendFileSync(to, "late");
      },
    };

    const report = moveVerified("layout", moves, writerDuringMove);

    expect(report).toMatchObject({ outcome: "rolled-back", reason: "hash mismatch" });
    expect(read("memory", "learning", "notes.md")).toBe("first");
    expect(read("memory", "state", "sessions.json")).toBe("{}late");
    expect(existsSync(at("memory", "gold"))).toBe(false);
    expect(memoryMoveEvents(HOME)[0]).toMatchObject({
      entries: 2,
      reason: "hash mismatch",
    });
    expect(memoryMoveDetails(HOME)[0]).toMatchObject({
      detail: [at("memory", "gold", "sessions.json")],
    });
  });

  test("names a move it could not put back", () => {
    const moves = seedStores();
    let calls = 0;
    const stuckSeams: MoveSeams = {
      ...realSeams,
      rename: (from, to) => {
        calls += 1;
        if (calls >= 2) throw new Error("EIO");
        renameSync(from, to);
      },
    };

    moveVerified("layout", moves, stuckSeams);

    expect(memoryMoveDetails(HOME)[0]).toMatchObject({ stuck: [moves[0].to] });
  });
});

describe("undoVerifiedMove", () => {
  test("says there is nothing to undo without a manifest of that name", () => {
    writeFile(
      at("backups", "memory-backups-2026-11-19T10-00-00-000Z.manifest.jsonl"),
      ""
    );

    expect(undoVerifiedMove("memory")).toEqual({
      outcome: "nothing-to-undo",
      manifest: null,
      putBack: 0,
      differ: [],
      leftInPlace: [],
    });
    expect(memoryMoveEvents(HOME)).toEqual([]);
  });

  test("renames every move back and finds every file unchanged", () => {
    const moves = seedStores();
    moveVerified("layout", moves);

    const report = undoVerifiedMove("layout");

    expect(report).toMatchObject({
      outcome: "undone",
      putBack: 2,
      differ: [],
      leftInPlace: [],
    });
    expectUntouched();
    expect(memoryMoveEvents(HOME).at(-1)).toMatchObject({
      outcome: "undone",
      entries: 2,
      differ: 0,
      manifest: manifestsIn(HOME)[0],
    });
  });

  test("names a file that changed since the manifest", () => {
    const moves = seedStores();
    moveVerified("layout", moves);
    appendFileSync(at("memory", "silver", "learning", "notes.md"), "!");

    const report = undoVerifiedMove("layout");

    expect(report.differ).toEqual([at("memory", "learning", "notes.md")]);
    expect(memoryMoveEvents(HOME).at(-1)).toMatchObject({ differ: 1 });
  });

  test("leaves a move in place whose old path was written again", () => {
    const moves = seedStores();
    moveVerified("layout", moves);
    writeFile(at("memory", "state", "sessions.json"), "new");

    const report = undoVerifiedMove("layout");

    expect(report).toMatchObject({ putBack: 1, leftInPlace: [moves[1].to] });
    expect(read("memory", "gold", "sessions.json")).toBe("{}");
    expect(read("memory", "learning", "notes.md")).toBe("first");
  });

  test("reads the newest manifest of its own name only", () => {
    const moves = seedStores();
    moveVerified("layout", [moves[0]]);
    mkdirSync(at("memory", "learning-2"), { recursive: true });
    writeFile(at("memory", "learning-2", "x.md"), "x");
    Bun.sleepSync(2);
    moveVerified("layout", [
      { from: at("memory", "learning-2"), to: at("memory", "silver", "x") },
    ]);
    writeFile(at("backups", "layout-zzz.manifest.jsonl"), "not ours");
    writeFile(at("backups", "layout-extra-2099-01-01T00-00-00-000Z.manifest.jsonl"), "");

    const report = undoVerifiedMove("layout");

    expect(report.putBack).toBe(1);
    expect(read("memory", "learning-2", "x.md")).toBe("x");
    expect(existsSync(at("memory", "silver", "learning", "notes.md"))).toBe(true);
  });

  test("skips a malformed manifest line", () => {
    const moves = seedStores();
    const { manifest } = moveVerified("layout", moves);
    appendFileSync(manifest ?? "", "{not json\n");

    expect(undoVerifiedMove("layout").putBack).toBe(2);
  });
});
