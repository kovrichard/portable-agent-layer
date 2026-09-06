import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ArchiveEntry } from "../src/hooks/lib/import-merge";
import {
  appendImportLog,
  isNeverImport,
  mergeArchive,
  mergeJsonlLines,
  readManifest,
  summarize,
} from "../src/hooks/lib/import-merge";

let HOME: string;
let QUARANTINE: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-merge-home-"));
  QUARANTINE = resolve(HOME, "backups", "incoming");
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
});

/** An archive entry without a zip — the seam ArchiveEntry exists to expose. */
function entry(path: string, body: string): ArchiveEntry {
  return { path, data: () => Buffer.from(body) };
}

function local(rel: string, body: string) {
  const target = resolve(HOME, rel);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, body);
}

function read(rel: string): string {
  return readFileSync(resolve(HOME, rel), "utf-8");
}

describe("mergeJsonlLines", () => {
  test("appends only unseen lines, preserving local order", () => {
    const r = mergeJsonlLines('{"a":1}\n{"b":2}\n', '{"b":2}\n{"c":3}\n');
    expect(r.added).toBe(1);
    expect(r.text).toBe('{"a":1}\n{"b":2}\n{"c":3}\n');
  });

  test("is a no-op when incoming is a subset", () => {
    const r = mergeJsonlLines('{"a":1}\n{"b":2}\n', '{"a":1}\n');
    expect(r.added).toBe(0);
    expect(r.text).toBe('{"a":1}\n{"b":2}\n');
  });

  test("merging its own output again adds nothing", () => {
    const incoming = '{"c":3}\n';
    const once = mergeJsonlLines('{"a":1}\n', incoming);
    const twice = mergeJsonlLines(once.text, incoming);
    expect(twice.added).toBe(0);
    expect(twice.text).toBe(once.text);
  });

  test("tolerates blank lines and a missing trailing newline", () => {
    const r = mergeJsonlLines('{"a":1}', '\n\n{"b":2}');
    expect(r.text).toBe('{"a":1}\n{"b":2}\n');
  });

  // Two empty sides must not produce a lone newline that reads as a blank record.
  test("two empty sides yield an empty string, not a newline", () => {
    expect(mergeJsonlLines("", "")).toEqual({ text: "", added: 0 });
    expect(mergeJsonlLines("  \n\n", "")).toEqual({ text: "", added: 0 });
  });

  test("a duplicate inside the incoming side is added once", () => {
    const r = mergeJsonlLines("", '{"a":1}\n{"a":1}\n');
    expect(r.added).toBe(1);
    expect(r.text).toBe('{"a":1}\n');
  });

  // Byte equality is the dedupe key; two encodings of one record are two records.
  test("lines differing only in spacing are distinct records", () => {
    expect(mergeJsonlLines('{"a":1}\n', '{"a": 1}\n').added).toBe(1);
  });
});

describe("isNeverImport", () => {
  test("blocks machine identity and rebuildable indexes", () => {
    expect(isNeverImport("machine.json")).toBe(true);
    expect(isNeverImport("memory/learning/.retrieval-index.json")).toBe(true);
    expect(isNeverImport("export-manifest.json")).toBe(true);
  });

  test("allows ordinary corpus files", () => {
    expect(isNeverImport("memory/signals/ratings.jsonl")).toBe(false);
    expect(isNeverImport("telos/GOALS.md")).toBe(false);
    expect(isNeverImport("skills/my-skill/SKILL.md")).toBe(false);
  });

  // A zip may spell paths with backslashes or a ./ prefix; the denylist still applies.
  test("normalizes the separator and the leading ./ before matching", () => {
    expect(isNeverImport("./machine.json")).toBe(true);
    expect(isNeverImport("memory\\learning\\.retrieval-index.json")).toBe(true);
  });

  test("matches a whole segment, not a suffix of a longer name", () => {
    expect(isNeverImport("nested/machine.json")).toBe(true);
    expect(isNeverImport("my-machine.json")).toBe(false);
  });
});

describe("mergeArchive", () => {
  test("writes a file the home does not have yet", () => {
    const result = mergeArchive([entry("telos/GOALS.md", "# Goals\n")], HOME, QUARANTINE);
    expect(result.created).toEqual(["telos/GOALS.md"]);
    expect(read("telos/GOALS.md")).toBe("# Goals\n");
  });

  test("reports an unchanged file as identical and leaves it alone", () => {
    local("telos/GOALS.md", "same\n");
    const result = mergeArchive([entry("telos/GOALS.md", "same\n")], HOME, QUARANTINE);
    expect(result.identical).toEqual(["telos/GOALS.md"]);
    expect(result.created).toEqual([]);
  });

  test("unions a diverged jsonl and counts the records it gained", () => {
    local("memory/signals/ratings.jsonl", '{"r":1}\n');
    const result = mergeArchive(
      [entry("memory/signals/ratings.jsonl", '{"r":1}\n{"r":2}\n')],
      HOME,
      QUARANTINE
    );
    expect(result.merged).toEqual(["memory/signals/ratings.jsonl"]);
    expect(result.linesAdded).toBe(1);
    expect(read("memory/signals/ratings.jsonl")).toBe('{"r":1}\n{"r":2}\n');
  });

  // A conflict must lose neither side: local stays put, incoming goes to quarantine.
  test("quarantines the incoming copy of a diverged non-jsonl file", () => {
    local("telos/GOALS.md", "local\n");
    const result = mergeArchive(
      [entry("telos/GOALS.md", "incoming\n")],
      HOME,
      QUARANTINE
    );
    expect(result.conflicts).toEqual(["telos/GOALS.md"]);
    expect(read("telos/GOALS.md")).toBe("local\n");
    expect(readFileSync(resolve(QUARANTINE, "telos/GOALS.md"), "utf-8")).toBe(
      "incoming\n"
    );
  });

  test("names the quarantine directory only once something landed there", () => {
    local("telos/GOALS.md", "local\n");
    expect(mergeArchive([entry("a.md", "x")], HOME, QUARANTINE).quarantineDir).toBeNull();
    expect(
      mergeArchive([entry("telos/GOALS.md", "incoming\n")], HOME, QUARANTINE)
        .quarantineDir
    ).toBe(QUARANTINE);
  });

  test("skips a denylisted path instead of writing it", () => {
    local("machine.json", '{"id":"MINE"}');
    const result = mergeArchive([entry("machine.json", '{"id":"THEIRS"}')], HOME, "");
    expect(result.skipped).toEqual(["machine.json"]);
    expect(read("machine.json")).toBe('{"id":"MINE"}');
  });

  // A zip lists its directories as entries; they are not files to write.
  test("ignores directory and empty entries", () => {
    const result = mergeArchive([entry("skills/", ""), entry("", "")], HOME, QUARANTINE);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test("re-merging the same archive changes nothing the second time", () => {
    local("memory/signals/ratings.jsonl", '{"r":1}\n');
    const archive = [entry("memory/signals/ratings.jsonl", '{"r":2}\n')];
    mergeArchive(archive, HOME, QUARANTINE);
    const second = mergeArchive(archive, HOME, QUARANTINE);
    expect(second.linesAdded).toBe(0);
    expect(read("memory/signals/ratings.jsonl")).toBe('{"r":1}\n{"r":2}\n');
  });

  test("classifies every entry of a mixed archive", () => {
    local("memory/signals/ratings.jsonl", '{"r":1}\n');
    local("telos/GOALS.md", "local\n");
    local("telos/BELIEFS.md", "same\n");
    const result = mergeArchive(
      [
        entry("memory/signals/ratings.jsonl", '{"r":2}\n'),
        entry("telos/GOALS.md", "incoming\n"),
        entry("telos/BELIEFS.md", "same\n"),
        entry("skills/new/SKILL.md", "# New\n"),
        entry("machine.json", "{}"),
      ],
      HOME,
      QUARANTINE
    );
    expect(summarize(result)).toBe(
      "1 new, 1 merged (+1 records), 1 unchanged, 1 conflicts, 1 skipped"
    );
  });
});

describe("readManifest", () => {
  const full = {
    machineId: "mac-1",
    label: "Mac",
    os: "darwin",
    exportedAt: "2026-01-01",
    fileCount: 12,
  };

  test("reads the manifest entry out of the archive", () => {
    const found = readManifest([
      entry("telos/GOALS.md", "x"),
      entry("export-manifest.json", JSON.stringify(full)),
    ]);
    expect(found).toEqual(full);
  });

  test("an archive that predates manifests reads as null", () => {
    expect(readManifest([entry("telos/GOALS.md", "x")])).toBeNull();
  });

  test("malformed json reads as null rather than throwing", () => {
    expect(readManifest([entry("export-manifest.json", "{oops")])).toBeNull();
  });

  // Without a machine id there is nothing to attribute the records to, and the
  // archive is untrusted input — a number where a string belongs is not an id.
  test("a manifest with no usable machine id reads as null", () => {
    expect(readManifest([entry("export-manifest.json", '{"label":"Mac"}')])).toBeNull();
    expect(readManifest([entry("export-manifest.json", '{"machineId":""}')])).toBeNull();
    expect(readManifest([entry("export-manifest.json", '{"machineId":123}')])).toBeNull();
  });

  test("fills the optional fields, falling back to the id for the label", () => {
    const found = readManifest([entry("export-manifest.json", '{"machineId":"mac-1"}')]);
    expect(found).toEqual({
      machineId: "mac-1",
      label: "mac-1",
      os: "",
      exportedAt: "",
      fileCount: 0,
    });
  });
});

describe("appendImportLog", () => {
  const record = {
    ts: "2026-01-01",
    archive: "pal-export.zip",
    mode: "merge" as const,
    created: 1,
    merged: 2,
    identical: 3,
    conflicts: 0,
    skipped: 0,
    linesAdded: 4,
    quarantineDir: null,
  };

  function logLines(): string[] {
    return read("memory/state/import-log.jsonl")
      .split("\n")
      .filter((line) => line.trim());
  }

  test("creates the log on the first import", () => {
    appendImportLog(HOME, record);
    expect(logLines().map((l) => JSON.parse(l))).toEqual([record]);
  });

  // Each import is a separate record; the second must not replace the first.
  test("appends rather than replacing on a later import", () => {
    appendImportLog(HOME, record);
    appendImportLog(HOME, { ...record, archive: "second.zip" });
    expect(logLines().map((l) => JSON.parse(l).archive)).toEqual([
      "pal-export.zip",
      "second.zip",
    ]);
  });
});

describe("summarize", () => {
  const empty = {
    created: [],
    merged: [],
    identical: [],
    conflicts: [],
    skipped: [],
    linesAdded: 0,
    quarantineDir: null,
  };

  test("always reports new, merged and unchanged", () => {
    expect(summarize(empty)).toBe("0 new, 0 merged (+0 records), 0 unchanged");
  });

  // Conflicts and skips are exceptions — naming them at zero is noise.
  test("mentions conflicts and skips only when there are some", () => {
    expect(summarize({ ...empty, conflicts: ["a"] })).toContain("1 conflicts");
    expect(summarize({ ...empty, skipped: ["a"] })).toContain("1 skipped");
    expect(summarize(empty)).not.toContain("conflicts");
    expect(summarize(empty)).not.toContain("skipped");
  });

  test("counts records separately from the files they landed in", () => {
    expect(summarize({ ...empty, merged: ["a", "b"], linesAdded: 7 })).toContain(
      "2 merged (+7 records)"
    );
  });
});
