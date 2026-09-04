import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// A wrong diff does not throw. It produces a plausible delta that reconstructs
// the wrong file, and an example-based test written by the same person who
// wrote the diff will agree with it. So the contract is checked by replay:
// apply what was stored to the before-state and demand the after-state back,
// byte for byte, over edits nobody chose by hand.

let HOME: string;

beforeEach(async () => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-delta-"));
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

/** A small deterministic generator, so a failure names a seed that reproduces it. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomFile(next: () => number, lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    // Repeat from a small alphabet so the diff meets real ambiguity: unique
    // lines make alignment trivial and would hide an off-by-one.
    out.push(
      ["const a = 1;", "", "  return x;", "}", "// note", "const a = 1;"][
        Math.floor(next() * 6)
      ]
    );
  }
  return out.join("\n");
}

/** Random insertions, deletions and replacements — the shapes a real edit takes. */
function mutate(next: () => number, content: string): string {
  const lines = content.split("\n");
  const edits = 1 + Math.floor(next() * 4);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(next() * (lines.length + 1));
    const roll = next();
    if (roll < 0.34) lines.splice(at, 0, `inserted ${i}`);
    else if (roll < 0.67) lines.splice(at, 1 + Math.floor(next() * 3));
    else lines.splice(at, 1, `replaced ${i}`);
  }
  return lines.join("\n");
}

describe("delta replay", () => {
  test("reconstructs the after-state exactly, across 400 generated edits", async () => {
    const { recordAction, applyDelta } = await lib();

    for (let seed = 1; seed <= 400; seed++) {
      const next = rng(seed);
      const before = randomFile(next, Math.floor(next() * 40));
      const after = mutate(next, before);

      const entry = recordAction({
        tool: "Edit",
        target: resolve(HOME, "f.ts"),
        outcome: "applied",
        before,
        after,
      });

      const replayed = entry.delta ? applyDelta(before, entry.delta) : before;
      // Named seed on failure: the case is reproducible rather than a mystery.
      expect({ seed, replayed }).toEqual({ seed, replayed: after });
    }
  });

  test("a reconstructed file hashes to the after-state the entry recorded", async () => {
    const { recordAction, applyDelta } = await lib();

    for (let seed = 500; seed < 560; seed++) {
      const next = rng(seed);
      const before = randomFile(next, 5 + Math.floor(next() * 30));
      const after = mutate(next, before);

      const entry = recordAction({
        tool: "Edit",
        target: resolve(HOME, "f.ts"),
        outcome: "applied",
        before,
        after,
      });
      if (!entry.delta) continue;

      const replayed = applyDelta(before, entry.delta) as string;
      const rehashed = new Bun.CryptoHasher("sha256")
        .update(replayed, "utf-8")
        .digest("hex");
      expect(entry.after).not.toBeNull();
      const recorded = (entry.after as { hash: string }).hash;
      expect({ seed, rehashed }).toEqual({ seed, rehashed: recorded });
    }
  });

  // Newlines are where a line-based delta is easiest to get quietly wrong.
  test("preserves trailing newlines exactly", async () => {
    const { recordAction, applyDelta } = await lib();
    const cases: [string, string][] = [
      ["a\nb\n", "a\nB\n"],
      ["a\nb", "a\nb\n"],
      ["a\nb\n", "a\nb"],
      ["\n", ""],
      ["", "\n"],
      ["a", "a\n\n\n"],
    ];

    for (const [before, after] of cases) {
      const entry = recordAction({
        tool: "Edit",
        target: resolve(HOME, "f.ts"),
        outcome: "applied",
        before,
        after,
      });
      const replayed = entry.delta ? applyDelta(before, entry.delta) : before;
      expect({ before, after, replayed }).toEqual({ before, after, replayed: after });
    }
  });
});

describe("what a delta records", () => {
  test("keeps the change to a large file, which the old whole-file cap dropped", async () => {
    const { recordAction, applyDelta } = await lib();
    const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
    const edited = big.replace("line 2000", "line 2000 // touched");

    const entry = recordAction({
      tool: "Edit",
      target: resolve(HOME, "big.ts"),
      outcome: "applied",
      before: big,
      after: edited,
    });

    // Far past the 4096 cap that used to decide whether any text was kept.
    expect(entry.before?.bytes).toBeGreaterThan(30000);
    expect(entry.delta?.truncated).toBeUndefined();
    expect(entry.delta?.hunks).toHaveLength(1);
    expect(applyDelta(big, entry.delta as never)).toBe(edited);
  });

  test("gives up on a change too large to keep, rather than keeping part of it", async () => {
    const { recordAction, applyDelta } = await lib();
    const before = "";
    const after = Array.from({ length: 500 }, (_, i) => `wholly new line ${i}`).join(
      "\n"
    );

    const entry = recordAction({
      tool: "Write",
      target: resolve(HOME, "big.ts"),
      outcome: "applied",
      before,
      after,
    });

    expect(entry.delta?.truncated).toBe(true);
    expect(entry.delta?.hunks).toEqual([]);
    // A delta that cannot be replayed says so, instead of returning a wrong file.
    expect(applyDelta(before, entry.delta as never)).toBeNull();
    // The hashes still tie the entry to real files.
    expect(entry.after?.hash).toHaveLength(64);
  });

  test("an unchanged file records no delta", async () => {
    const { recordAction } = await lib();
    const entry = recordAction({
      tool: "Write",
      target: resolve(HOME, "f.ts"),
      outcome: "applied",
      before: "same",
      after: "same",
    });
    expect(entry.delta).toBeUndefined();
  });

  // The refusal did not empty the file, and a delta saying it did would be the
  // ledger asserting something that never happened.
  test("an action that did not land records no delta", async () => {
    const { recordAction } = await lib();
    for (const outcome of ["denied", "failed"] as const) {
      const entry = recordAction({
        tool: "Edit",
        target: resolve(HOME, "f.ts"),
        outcome,
        before: "untouched",
        after: null,
        reason: "nope",
      });
      expect(entry.delta).toBeUndefined();
      expect(entry.after).toBeNull();
      expect(entry.before?.hash).toHaveLength(64);
    }
  });

  test("records a file creation as an insertion from nothing", async () => {
    const { recordAction, applyDelta } = await lib();
    const entry = recordAction({
      tool: "Write",
      target: resolve(HOME, "new.ts"),
      outcome: "applied",
      before: null,
      after: "fresh\ncontent\n",
    });

    expect(entry.before).toBeNull();
    expect(applyDelta(null, entry.delta as never)).toBe("fresh\ncontent\n");
  });
});
