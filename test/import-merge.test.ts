import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

/** Every path named `name` under `dir`, sorted so the first hit is stable. */
function findUnder(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) {
      hits.push(resolve(entry.parentPath, entry.name));
    }
  }
  return hits.sort();
}

let SRC: string;
let DST: string;
let WORK: string;

function cli(home: string, args: string[], input = "y\n") {
  return spawnSync("bun", ["run", CLI, "cli", ...args], {
    env: { ...process.env, PAL_HOME: home },
    encoding: "utf-8",
    input,
    timeout: 20000,
  });
}

function write(home: string, rel: string, content: string) {
  const p = resolve(home, rel);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, content);
}

function read(home: string, rel: string): string {
  return readFileSync(resolve(home, rel), "utf-8");
}

function lines(home: string, rel: string): string[] {
  return read(home, rel)
    .split("\n")
    .filter((l) => l.trim());
}

beforeEach(() => {
  SRC = mkdtempSync(resolve(tmpdir(), "pal-src-"));
  DST = mkdtempSync(resolve(tmpdir(), "pal-dst-"));
  WORK = mkdtempSync(resolve(tmpdir(), "pal-work-"));

  // SRC = the "Mac": two ratings, one reflection, its own skill
  write(
    SRC,
    "memory/signals/ratings.jsonl",
    '{"ts":"2026-01-01","rating":9}\n{"ts":"2026-01-02","rating":8}\n'
  );
  write(
    SRC,
    "memory/learning/reflections/algorithm-reflections.jsonl",
    '{"timestamp":"2026-01-01","q1":"mac lesson"}\n'
  );
  write(SRC, "skills/mac-skill/SKILL.md", "# Mac Skill\n");
  write(SRC, "telos/GOALS.md", "# Goals\nmac version\n");

  // DST = the "Linux box": a DIFFERENT rating, a different reflection, its own skill
  write(DST, "memory/signals/ratings.jsonl", '{"ts":"2026-02-01","rating":6}\n');
  write(
    DST,
    "memory/learning/reflections/algorithm-reflections.jsonl",
    '{"timestamp":"2026-02-01","q1":"linux lesson"}\n'
  );
  write(DST, "skills/linux-skill/SKILL.md", "# Linux Skill\n");
  write(DST, "telos/GOALS.md", "# Goals\nlinux version\n");
});

afterEach(() => {
  for (const d of [SRC, DST, WORK]) rmSync(d, { recursive: true, force: true });
});

describe("import into a NON-EMPTY home", () => {
  test("merges jsonl records from both sides instead of overwriting", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    const r = cli(DST, ["import", WORK]);
    expect(r.status).toBe(0);

    const ratings = lines(DST, "memory/signals/ratings.jsonl");
    // local record survives
    expect(ratings.some((l) => l.includes("2026-02-01"))).toBe(true);
    // imported records arrive
    expect(ratings.some((l) => l.includes("2026-01-01"))).toBe(true);
    expect(ratings.some((l) => l.includes("2026-01-02"))).toBe(true);
    expect(ratings.length).toBe(3);

    const refl = lines(DST, "memory/learning/reflections/algorithm-reflections.jsonl");
    expect(refl.length).toBe(2);
    expect(refl.some((l) => l.includes("linux lesson"))).toBe(true);
    expect(refl.some((l) => l.includes("mac lesson"))).toBe(true);
  });

  test("keeps both machines' personal skills", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);

    expect(existsSync(resolve(DST, "skills", "linux-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(resolve(DST, "skills", "mac-skill", "SKILL.md"))).toBe(true);
  });

  test("does not destroy a diverged non-jsonl file; quarantines the incoming copy", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);

    // local wins in place
    expect(read(DST, "telos/GOALS.md")).toContain("linux version");
    // incoming is preserved somewhere under backups/, not silently dropped
    const found = findUnder(resolve(DST, "backups"), "GOALS.md");
    expect(found.length).toBeGreaterThan(0);
    expect(readFileSync(found[0], "utf-8")).toContain("mac version");
  });

  test("is idempotent — importing twice does not duplicate records", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);
    const afterFirst = lines(DST, "memory/signals/ratings.jsonl").length;

    expect(cli(DST, ["import", WORK]).status).toBe(0);
    const afterSecond = lines(DST, "memory/signals/ratings.jsonl").length;

    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).toBe(3);
  });

  test("writes an import log entry per run", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);

    const logLines = lines(DST, "memory/state/import-log.jsonl");
    expect(logLines.length).toBe(2);
    expect(JSON.parse(logLines[0])).toHaveProperty("archive");
  });

  test("--overwrite restores backup semantics (local side replaced)", () => {
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK, "--overwrite"]).status).toBe(0);

    const ratings = lines(DST, "memory/signals/ratings.jsonl");
    expect(ratings.length).toBe(2);
    expect(ratings.some((l) => l.includes("2026-02-01"))).toBe(false);
  });

  test("never imports machine.json even if present in the archive", () => {
    write(SRC, "memory/state/x.json", "{}");
    writeFileSync(resolve(SRC, "machine.json"), '{"id":"SRC-ID"}');
    writeFileSync(resolve(DST, "machine.json"), '{"id":"DST-ID"}');
    expect(cli(SRC, ["export", WORK]).status).toBe(0);
    expect(cli(DST, ["import", WORK]).status).toBe(0);

    expect(read(DST, "machine.json")).toContain("DST-ID");
  });
});

describe("mergeJsonlLines", () => {
  test("appends only unseen lines, preserving local order", async () => {
    const { mergeJsonlLines } = await import("../src/hooks/lib/import-merge");
    const r = mergeJsonlLines('{"a":1}\n{"b":2}\n', '{"b":2}\n{"c":3}\n');
    expect(r.added).toBe(1);
    expect(r.text).toBe('{"a":1}\n{"b":2}\n{"c":3}\n');
  });

  test("is a no-op when incoming is a subset", async () => {
    const { mergeJsonlLines } = await import("../src/hooks/lib/import-merge");
    const r = mergeJsonlLines('{"a":1}\n{"b":2}\n', '{"a":1}\n');
    expect(r.added).toBe(0);
    expect(r.text).toBe('{"a":1}\n{"b":2}\n');
  });

  test("merging its own output again adds nothing", async () => {
    const { mergeJsonlLines } = await import("../src/hooks/lib/import-merge");
    const incoming = '{"c":3}\n';
    const once = mergeJsonlLines('{"a":1}\n', incoming);
    const twice = mergeJsonlLines(once.text, incoming);
    expect(twice.added).toBe(0);
    expect(twice.text).toBe(once.text);
  });

  test("tolerates blank lines and a missing trailing newline", async () => {
    const { mergeJsonlLines } = await import("../src/hooks/lib/import-merge");
    const r = mergeJsonlLines('{"a":1}', '\n\n{"b":2}');
    expect(r.text).toBe('{"a":1}\n{"b":2}\n');
  });
});

describe("isNeverImport", () => {
  test("blocks machine identity and rebuildable indexes", async () => {
    const { isNeverImport } = await import("../src/hooks/lib/import-merge");
    expect(isNeverImport("machine.json")).toBe(true);
    expect(isNeverImport("memory/learning/.retrieval-index.json")).toBe(true);
  });

  test("allows ordinary corpus files", async () => {
    const { isNeverImport } = await import("../src/hooks/lib/import-merge");
    expect(isNeverImport("memory/signals/ratings.jsonl")).toBe(false);
    expect(isNeverImport("telos/GOALS.md")).toBe(false);
    expect(isNeverImport("skills/my-skill/SKILL.md")).toBe(false);
  });
});

describe("machine identity crosses on import", () => {
  test("source machine is named and its label resolves afterwards", async () => {
    cli(SRC, ["export", WORK]);
    const srcId = JSON.parse(readFileSync(resolve(SRC, "machine.json"), "utf-8"))
      .id as string;

    const r = cli(DST, ["import", WORK]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Source machine:");

    // DST keeps its own identity...
    const dstId = JSON.parse(readFileSync(resolve(DST, "machine.json"), "utf-8"))
      .id as string;
    expect(dstId).not.toBe(srcId);

    // ...and can now name the machine those records came from.
    expect(existsSync(resolve(DST, "memory", "machines", `${srcId}.md`))).toBe(true);

    const logged = lines(DST, "memory/state/import-log.jsonl").map((l) => JSON.parse(l));
    expect(logged[0].sourceMachineId).toBe(srcId);
  });
});
