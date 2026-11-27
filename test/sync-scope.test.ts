import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { directoryStore } from "../src/sync/blob-store";
import { syncKindOf } from "../src/sync/scope";
import { freshTestDir } from "./lib/test-home";

describe("syncKindOf", () => {
  for (const [path, kind] of [
    ["records/bronze/events/2026-11.jsonl", "segments"],
    ["records/bronze/event-text/2026-11.jsonl", "segments"],
    ["work/progress-tree/events.jsonl", "segments"],
    ["records/ratings/ratings.jsonl", "segments"],
    ["records/rule-candidates/candidates.jsonl", "segments"],
    ["work/projects/pal/history.jsonl", "segments"],
    ["records/import-log/import-log.jsonl", "segments"],
    ["work/unbound-history/loose.jsonl", "segments"],
    ["records/labelled-turns/turns-2026-11.jsonl", "segments"],
    ["records/review-queue/_review.jsonl", "segments"],
    ["work/projects/pal/tickets.jsonl", "segments"],
    ["work/projects/pal/ISA.md", "whole"],
    ["memory/sales/diary-events.jsonl", "whole"],
    ["records/bronze/events/notes.md", "whole"],
    ["telos/GOALS.md", "whole"],
    ["memory/statement.md", "whole"],
    ["records/ledger/actions.jsonl", null],
    ["records/raw/claude/x.jsonl.gz", null],
    ["memory/state", null],
    ["memory/state/sessions.json", null],
    ["memory/content/claude/x.gz", null],
    ["memory/downloads/a.pdf", null],
    ["telos/backups/GOALS.md", null],
    ["skills/listen.bak-20261110/SKILL.md", null],
    ["memory/adaptation/rules.json.tmp", null],
    ["memory/relationship/opinions-context.md", null],
    ["memory/relationship/notes.md", "whole"],
  ] as const)
    test(`${path} → ${kind}`, () => {
      expect(syncKindOf(path)).toBe(kind);
    });
});

describe("directoryStore", () => {
  const store = () => directoryStore(resolve(freshTestDir(import.meta.file), "bucket"));

  test("a put that may not replace refuses a taken name and leaves it as it was", async () => {
    const bucket = store();

    expect(await bucket.put("key/a", new Uint8Array([1]), { ifAbsent: true })).toBe(true);
    expect(await bucket.put("key/a", new Uint8Array([2]), { ifAbsent: true })).toBe(
      false
    );
    expect(await bucket.get("key/a")).toEqual(new Uint8Array([1]));
  });

  test("a plain put replaces", async () => {
    const bucket = store();
    await bucket.put("manifest/m", new Uint8Array([1]));
    await bucket.put("manifest/m", new Uint8Array([2]));

    expect(await bucket.get("manifest/m")).toEqual(new Uint8Array([2]));
  });

  test("lists names under a prefix, sorted, and gets nothing for a missing name", async () => {
    const bucket = store();

    for (const name of ["seg/m/f/2", "seg/m/f/1", "whole/f/1"])
      await bucket.put(name, new Uint8Array([0]));

    expect(await bucket.list("seg/")).toEqual(["seg/m/f/1", "seg/m/f/2"]);
    expect(await bucket.list("manifest/")).toEqual([]);
    expect(await bucket.get("seg/m/f/3")).toBeNull();
  });
});
