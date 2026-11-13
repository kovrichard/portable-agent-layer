import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { v1Projects } from "../src/cli/migrations/v1-projects";
import { v2ThreadsToIsc } from "../src/cli/migrations/v2-threads-to-isc";
import { v10ThreadsToProgressTree } from "../src/cli/migrations/v10-threads-to-progress-tree";
import { scopeOf } from "../src/hooks/lib/progress-tree";
import { readProject } from "../src/hooks/lib/projects";
import {
  boundProject,
  homeFile,
  isaFile,
  legacyIsa,
  STAMP,
  unboundProject,
  writeAt,
} from "./lib/migration-home-fixture";
import { freshTestDir } from "./lib/test-home";

beforeEach(() => {
  process.env.PAL_HOME = freshTestDir(import.meta.file);
});

const progressFile = (name: string) => homeFile("memory", "state", "progress", name);
const threadsFile = () => homeFile("memory", "state", "threads.jsonl");

function legacyProject(name: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    name,
    path: homeFile("absent", name),
    status: "active",
    created: STAMP,
    updated: STAMP,
    facts: [`fact about ${name}`],
    ...extra,
  });
}

describe("v1-projects", () => {
  test("is not pending when progress/ holds no JSON", () => {
    writeAt(progressFile("notes.txt"), "not json");
    expect(v1Projects.check()).toEqual({ pending: false, detail: undefined });
  });

  test("counts only JSON files whose project has no ISA yet", () => {
    writeAt(progressFile("alpha.json"), legacyProject("alpha"));
    writeAt(progressFile("beta.json"), legacyProject("beta"));
    writeAt(progressFile("gamma-two.json"), legacyProject("gamma-two"));
    writeAt(progressFile("readme.md"), "# not a project");
    unboundProject("gamma-two");

    expect(v1Projects.check()).toEqual({
      pending: true,
      detail: "2 file(s) in progress/",
    });
  });

  test("writes an ISA per legacy file and keeps the source", () => {
    writeAt(progressFile("alpha.json"), legacyProject("alpha"));

    expect(v1Projects.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["alpha: migrated (source kept)"],
    });
    expect(readProject("alpha")?.context).toBe("fact about alpha");
    expect(existsSync(progressFile("alpha.json"))).toBe(true);
    expect(v1Projects.check().pending).toBe(false);
  });

  test("a dry run reports without writing", () => {
    writeAt(progressFile("alpha.json"), legacyProject("alpha"));

    expect(v1Projects.run(true)).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["alpha: would migrate (source kept)"],
    });
    expect(readProject("alpha")).toBeNull();
  });

  test("skips malformed and unreadable files and still migrates the rest", () => {
    writeAt(progressFile("broken.json"), "{ not json");
    writeAt(progressFile("nameless.json"), legacyProject("", { name: undefined }));
    writeAt(progressFile("good.json"), legacyProject("good"));

    const result = v1Projects.run();

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.results.sort()).toEqual([
      "broken: skipped (read/write error)",
      "good: migrated (source kept)",
      "nameless: skipped (malformed JSON)",
    ]);
  });
});

interface ThreadFields {
  cwd: string;
  status?: "open" | "resolved";
}

function threadLine(id: string, fields: ThreadFields): string {
  return JSON.stringify({
    id,
    title: `do ${id}`,
    context: "",
    status: "open",
    created: STAMP,
    resolved: null,
    ...fields,
  });
}

const writeThreadLines = (...lines: string[]) =>
  writeAt(threadsFile(), `${lines.join("\n\n")}\n`);

const storedThreads = () =>
  readFileSync(threadsFile(), "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

describe("v2-threads-to-isc", () => {
  test("is pending for an open thread inside a bound project", () => {
    const dir = boundProject("app");
    unboundProject("aaa-unbound");
    writeThreadLines(threadLine("t1", { cwd: `${dir}/` }));

    expect(v2ThreadsToIsc.check()).toEqual({
      pending: true,
      detail: "1 thread(s) to migrate",
    });
  });

  test.each([
    ["resolved thread", { status: "resolved" as const }],
    ["thread outside every project", { cwd: "elsewhere" }],
  ])("is not pending for a %s", (_label, fields) => {
    const dir = boundProject("app");
    writeThreadLines(threadLine("t1", { cwd: dir, ...fields }));

    expect(v2ThreadsToIsc.check()).toEqual({ pending: false, detail: undefined });
  });

  test("does not seed bindings when there are no open threads", () => {
    const dir = homeFile("checkouts", "legacy");
    writeAt(homeFile("checkouts", "legacy", "README.md"), "");
    legacyIsa("legacy", `status: active\npath: ${dir}`);

    expect(v2ThreadsToIsc.check().pending).toBe(false);
    expect(existsSync(homeFile("bindings.json"))).toBe(false);
  });

  test.each([
    ["an empty criteria section", undefined, "- [ ] ISC-1: do t1"],
    [
      "the highest real ISC id",
      [
        "- [x] ISC-3: done",
        "- [ ] ISC-12: big",
        "-  [~]  isc-14: spaced",
        "note - [ ] ISC-99: not a checkbox",
        "- [?] ISC-98: unknown mark",
        "- [ ] ISC-97 no colon",
      ].join("\n"),
      "- [ ] ISC-15: do t1",
    ],
  ])("appends the thread as the next ISC after %s", (_label, criteria, added) => {
    const dir = boundProject("app", criteria);
    writeThreadLines(
      threadLine("t1", { cwd: dir }),
      threadLine("t2", { cwd: "elsewhere" })
    );

    expect(v2ThreadsToIsc.run()).toEqual({
      migrated: 1,
      skipped: 0,
      results: ['t1 → app ISC: added "do t1" (thread source kept)'],
    });
    const lines = (readProject("app")?.criteria ?? "").split("\n");
    expect(lines.at(-1)).toBe(added);
    expect(lines.length).toBe(criteria ? criteria.split("\n").length + 1 : 1);

    const [t1, t2] = storedThreads();
    expect(t1.status).toBe("resolved");
    expect(Number.isNaN(Date.parse(t1.resolved))).toBe(false);
    expect(t1.title).toBe("do t1");
    expect(t2).toMatchObject({ id: "t2", status: "open", resolved: null });
  });

  test("a dry run leaves the project and the threads file untouched", () => {
    const dir = boundProject("app", "- [ ] ISC-1: first");
    const before = writeThreadLines(
      threadLine("t1", { cwd: dir }),
      threadLine("t2", { cwd: "elsewhere" })
    );

    expect(v2ThreadsToIsc.run(true)).toEqual({
      migrated: 1,
      skipped: 0,
      results: ['t1 → app ISC: would add "do t1" (thread source kept)'],
    });
    expect(readProject("app")?.criteria).toBe("- [ ] ISC-1: first");
    expect(readFileSync(threadsFile(), "utf-8")).toBe(before);
  });

  test("skips a thread whose project record cannot be reread by name", () => {
    const dir = boundProject("renamed");
    const isa = isaFile("renamed");
    writeFileSync(
      isa,
      readFileSync(isa, "utf-8").replace('name: "renamed"', 'name: "other"')
    );
    writeFileSync(homeFile("bindings.json"), JSON.stringify({ other: dir }));
    const before = writeThreadLines(
      threadLine("t1", { cwd: dir }),
      threadLine("t2", { cwd: "elsewhere" })
    );

    expect(v2ThreadsToIsc.run()).toEqual({
      migrated: 0,
      skipped: 1,
      results: ['t1: skipped (project "other" unreadable)'],
    });
    expect(readFileSync(threadsFile(), "utf-8")).toBe(before);
  });

  test("skips a thread whose project cannot be written and keeps going", () => {
    const locked = boundProject("locked");
    const open = boundProject("open");
    writeThreadLines(threadLine("t1", { cwd: locked }), threadLine("t2", { cwd: open }));
    chmodSync(isaFile("locked"), 0o444);

    try {
      expect(v2ThreadsToIsc.run()).toEqual({
        migrated: 1,
        skipped: 1,
        results: [
          "t1: skipped (error)",
          't2 → open ISC: added "do t2" (thread source kept)',
        ],
      });
    } finally {
      chmodSync(isaFile("locked"), 0o644);
    }

    expect(storedThreads().map((t) => t.status)).toEqual(["open", "resolved"]);
  });
});

describe("v10-threads-to-progress-tree", () => {
  const folder = homeFile("work");

  test("counts open threads not yet in the tree", () => {
    writeThreadLines(
      threadLine("t1", { cwd: folder }),
      threadLine("t2", { cwd: folder }),
      threadLine("t3", { cwd: folder, status: "resolved" })
    );

    expect(v10ThreadsToProgressTree.check()).toEqual({
      pending: true,
      detail: "2 open thread(s)",
    });
    v10ThreadsToProgressTree.run();
    expect(v10ThreadsToProgressTree.check()).toEqual({
      pending: false,
      detail: undefined,
    });
  });

  test("reports each park, and skips a thread with no folder", () => {
    writeThreadLines(
      threadLine("t1", { cwd: folder }),
      JSON.stringify({ id: "t2", status: "open" })
    );
    const parked = `t1: parked "do t1" in ${scopeOf(folder)} (thread source kept)`;

    expect(v10ThreadsToProgressTree.run(true).results[0]).toBe(
      parked.replace("parked", "would park")
    );
    const { migrated, skipped, results } = v10ThreadsToProgressTree.run();

    expect({ migrated, skipped }).toEqual({ migrated: 1, skipped: 1 });
    expect(results[0]).toBe(parked);
    expect(results[1]).toStartWith("t2: skipped (");
  });
});
