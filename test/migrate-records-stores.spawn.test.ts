import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { storeLocation } from "../src/bronze/bronze";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { reload } from "../src/core/settings";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const ID = "v14-records-stores";
let HOME: string;

const at = (...parts: string[]) => resolve(HOME, ...parts);

const OLD_FILES: Record<string, string> = {
  "memory/ledger/actions.jsonl": '{"a":1}\n',
  "memory/ledger/pending/toolu_1.json": "{}",
  "memory/signals/ratings.jsonl": '{"rating":9}\n',
  "memory/signals/claim-checks/2026-11.jsonl": '{"c":1}\n',
  "memory/adaptation/turns-2026-11.jsonl": '{"t":1}\n',
  "memory/adaptation/rule-events.jsonl": '{"e":1}\n',
  "memory/adaptation/candidates.jsonl": '{"k":1}\n',
  "memory/learning/run-estimates.jsonl": '{"r":1}\n',
  "memory/learning/reflections/algorithm-reflections.jsonl": '{"q":1}\n',
  "memory/state/sessions-archive/2026-11.jsonl": '{"s":1}\n',
  "memory/state/import-log.jsonl": '{"i":1}\n',
  "memory/knowledge/_review.jsonl": '{"v":1}\n',
};

const STAYS: Record<string, string> = {
  "memory/adaptation/rules.json": "[]",
  "memory/signals/interaction/x.json": "{}",
  "memory/learning/failures-digest.md": "# digest\n",
  "memory/state/sessions.json": "{}",
  "memory/projects/alpha/ISA.md": "---\nname: alpha\n---\n",
  "memory/projects/alpha/history.jsonl": '{"h":1}\n',
  "memory/state/unbound-history/loose.jsonl": '{"u":1}\n',
  "memory/knowledge/People/ada.md": "# Ada\n",
  "memory/progress-tree/events.jsonl": '{"p":1}\n',
};

const MOVED_TO: Record<string, string> = {
  "memory/ledger/actions.jsonl": "records/ledger/actions.jsonl",
  "memory/ledger/pending/toolu_1.json": "records/ledger/pending/toolu_1.json",
  "memory/signals/ratings.jsonl": "records/ratings/ratings.jsonl",
  "memory/signals/claim-checks/2026-11.jsonl": "records/claim-checks/2026-11.jsonl",
  "memory/adaptation/turns-2026-11.jsonl": "records/labelled-turns/turns-2026-11.jsonl",
  "memory/adaptation/rule-events.jsonl": "records/rule-events/rule-events.jsonl",
  "memory/adaptation/candidates.jsonl": "records/rule-candidates/candidates.jsonl",
  "memory/learning/run-estimates.jsonl": "records/run-estimates/run-estimates.jsonl",
  "memory/learning/reflections/algorithm-reflections.jsonl":
    "records/reflections/algorithm-reflections.jsonl",
  "memory/state/sessions-archive/2026-11.jsonl": "records/sessions-archive/2026-11.jsonl",
  "memory/state/import-log.jsonl": "records/import-log/import-log.jsonl",
  "memory/knowledge/_review.jsonl": "records/review-queue/_review.jsonl",
};

function write(rel: string, body: string): void {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), body);
}

function printedBy(args: string[]): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => lines.push(parts.join(" "));

  try {
    runMigrate(args);
  } finally {
    console.log = original;
  }

  return lines.join("\n");
}

beforeEach(() => {
  HOME = resolve(freshTestDir(import.meta.file), "home");
  process.env.PAL_HOME = HOME;
  reload();

  for (const [rel, body] of Object.entries({ ...OLD_FILES, ...STAYS })) write(rel, body);
});

describe("before the owner runs it", () => {
  test("install leaves every store where it is, and PAL keeps reading it there", () => {
    applyPendingMigrations();

    for (const rel of Object.keys(OLD_FILES)) expect(existsSync(at(rel))).toBe(true);
    expect(existsSync(at("records"))).toBe(false);
    expect(storeLocation("ratings")).toBe(at("memory", "signals"));
    expect(storeLocation("labelled-turns")).toBe(at("memory", "adaptation"));
  });

  test("the doctor lists it with the command that runs it", () => {
    expect(checkPendingMigrations().find((m) => m.id === ID)?.ownerRun).toBe(true);
  });

  test("a dry run names each store's files and moves nothing", () => {
    const printed = printedBy([ID, "--dry-run"]).replaceAll(/\\+/g, "/");
    expect(printed).toContain("records/ratings/ratings.jsonl");
    expect(printed).not.toContain("rules.json");
    expect(existsSync(at("records"))).toBe(false);
  });
});

describe("run by its owner", () => {
  test("moves each store's files byte for byte and leaves what shared their folders", () => {
    expect(printedBy([ID, "--force"])).toContain("hashes checked");

    for (const [from, to] of Object.entries(MOVED_TO)) {
      expect({ to, body: readFileSync(at(to), "utf-8") }).toEqual({
        to,
        body: OLD_FILES[from],
      });
      expect(existsSync(at(from))).toBe(false);
    }

    for (const [rel, body] of Object.entries(STAYS))
      expect(readFileSync(at(rel), "utf-8")).toBe(body);
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
  });

  test("every moved store reads its new folder", () => {
    printedBy([ID, "--force"]);
    expect(storeLocation("ratings")).toBe(at("records", "ratings"));
    expect(storeLocation("labelled-turns")).toBe(at("records", "labelled-turns"));
    expect(storeLocation("ledger")).toBe(at("records", "ledger"));
    expect(storeLocation("project-history")).toBe(at("memory", "projects"));
  });

  test("a late append and a new month's file at the old places are folded in by the next install", () => {
    printedBy([ID, "--force"]);
    write("memory/signals/ratings.jsonl", '{"rating":9}\n{"rating":3}\n');
    write("memory/adaptation/turns-2026-12.jsonl", '{"t":2}\n');
    const swept = applyPendingMigrations().filter((line) => line.startsWith(ID));

    expect(swept.join("\n")).toContain("swept 2 late file(s)");
    expect(readFileSync(at("records/ratings/ratings.jsonl"), "utf-8")).toBe(
      '{"rating":9}\n{"rating":3}\n'
    );
    expect(readFileSync(at("records/labelled-turns/turns-2026-12.jsonl"), "utf-8")).toBe(
      '{"t":2}\n'
    );
    expect(existsSync(at("memory/signals/ratings.jsonl"))).toBe(false);
  });

  test("undo puts every file back and the stores read memory/ again", () => {
    printedBy([ID, "--force"]);
    printedBy(["--undo", ID]);

    for (const [rel, body] of Object.entries(OLD_FILES))
      expect(readFileSync(at(rel), "utf-8")).toBe(body);
    expect(existsSync(at("records"))).toBe(false);
    expect(storeLocation("ratings")).toBe(at("memory", "signals"));
  });
});

describe("a home that started on the new layout", () => {
  test("has nothing to move", () => {
    const fresh = resolve(freshTestDir(import.meta.file), "fresh");
    process.env.PAL_HOME = fresh;
    expect(checkPendingMigrations().some((m) => m.id === ID)).toBe(false);
    expect(storeLocation("ratings")).toBe(resolve(fresh, "records", "ratings"));
  });
});
