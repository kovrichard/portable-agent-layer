import { describe, expect, test } from "bun:test";
import { readProject } from "../src/hooks/lib/projects";
import {
  commitmentEvents,
  projectCli,
  projectCliHome,
  projectCliJson,
  SEEDED_AT,
  seedProject,
} from "./lib/project-cli-fixture";

const home = projectCliHome(import.meta.file);
const today = () => new Date().toISOString().slice(0, 10);

function seed(criteria?: string, changelog?: string): void {
  seedProject(home(), { criteria, changelog });
}

function stored() {
  const p = readProject("demo");
  if (!p) throw new Error("demo project missing");

  return p;
}

function expectTouched(): void {
  const updated = stored().updated;
  expect(updated).not.toBe(SEEDED_AT);
  expect(Date.now() - Date.parse(updated)).toBeLessThan(60_000);
}

function expectUntouched(criteria?: string): void {
  expect(stored().updated).toBe(SEEDED_AT);

  if (criteria !== undefined) expect(stored().criteria).toBe(criteria);
}

const REMINDER =
  "Surface the `announce` line to the user verbatim, on its own line. Every ISC you open MUST be announced with the 🎟️ ticket marker, in any response mode — omitting it is a defect.";

describe("add-isc", () => {
  test("opens ISC-1 in an empty project and tells the agent to announce it", async () => {
    seed();
    const run = await projectCli("add-isc", "demo", "ship", "it");

    expect(run.stdout).toBe(
      JSON.stringify(
        {
          added: true,
          id: 1,
          title: "ship it",
          announce: "🎟️ ISC #1 — ship it",
          reminder: REMINDER,
        },
        null,
        2
      )
    );
    expect(stored().criteria).toBe("- [ ] ISC-1: ship it");
    expectTouched();
    expect(commitmentEvents(home())).toEqual([
      { iscProject: "demo", isc: 1, outcome: "opened", surface: "cli" },
    ]);
  });

  test("appends after the existing lines and never reuses an archived id", async () => {
    seed("- [ ] ISC-1: first\n\n", "### Archived 2026-01-01\n- [x] ISC-5: old");
    const out = await projectCliJson("add-isc", "demo", "  next one  ");

    expect(out).toMatchObject({ id: 6, title: "next one" });
    expect(stored().criteria).toBe("- [ ] ISC-1: first\n- [ ] ISC-6: next one");
  });

  test("stores a multi-line title on one line", async () => {
    seed();
    await projectCliJson("add-isc", "demo", "first\nsecond");

    expect(stored().criteria).toBe(String.raw`- [ ] ISC-1: first\nsecond`);
  });

  test("a blank title is a usage error and writes nothing", async () => {
    seed("- [ ] ISC-1: first");
    const run = await projectCli("add-isc", "demo", "   ");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("error: <title...> is empty");
    expectUntouched("- [ ] ISC-1: first");
  });

  test("an unknown project exits 1 with a pointer to list", async () => {
    const run = await projectCli("add-isc", "nope", "x");

    expect(run).toEqual({
      code: 1,
      stdout: "",
      stderr: `No project named "nope". Run 'list' to see registered projects.\n`,
    });
  });
});

describe("complete-isc", () => {
  test("moves the line into a dated archive in the Changelog", async () => {
    seed("- [ ] ISC-1: ship it\n- [ ] ISC-2: later");

    expect(await projectCliJson("complete-isc", "demo", "1")).toEqual({
      checked: true,
      id: 1,
      archived: true,
    });
    expect(stored().criteria).toBe("- [ ] ISC-2: later");
    expect(stored().changelog).toBe(`### Archived ${today()}\n- [x] ISC-1: ship it`);
    expectTouched();
    expect(commitmentEvents(home())).toEqual([
      { iscProject: "demo", isc: 1, outcome: "kept", surface: "cli" },
    ]);
  });

  test("an already archived ISC is reported as done and left alone", async () => {
    seed("- [ ] ISC-2: later", "### Archived 2026-01-01\n- [x] ISC-1: done");

    expect(await projectCliJson("complete-isc", "demo", "1")).toEqual({
      checked: true,
      id: 1,
      alreadyDone: true,
    });
    expectUntouched("- [ ] ISC-2: later");
    expect(commitmentEvents(home())).toEqual([]);
  });

  test("a missing ISC exits 1 naming the project", async () => {
    seed("- [ ] ISC-1: ship it");
    const run = await projectCli("complete-isc", "demo", "9");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`ISC-9 not found in project "demo"\n`);
    expect(run.stdout).toBe("");
  });

  test.each<[string, string, string[]]>([
    ["complete-isc", "0", []],
    ["complete-isc", "1.5", []],
    ["complete-isc", "abc", []],
    ["edit-isc", "0", ["new"]],
    ["retire-isc", "0", []],
  ])("%s with id %p is a usage error", async (command, id, text) => {
    seed("- [ ] ISC-1: ship it");
    const run = await projectCli(command, "demo", id, ...text);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`error: <id> must be a positive integer, got "${id}"`);
    expectUntouched("- [ ] ISC-1: ship it");
  });
});

describe("reopen-isc", () => {
  test("pulls an archived ISC back into Criteria as open", async () => {
    seed("- [ ] ISC-2: later", "### Archived 2026-01-01\n- [x] ISC-1: done");

    expect(await projectCliJson("reopen-isc", "demo", "1")).toEqual({
      checked: false,
      id: 1,
    });
    expect(stored().criteria).toBe("- [ ] ISC-2: later\n- [ ] ISC-1: done");
    expectTouched();
    expect(commitmentEvents(home())).toEqual([
      { iscProject: "demo", isc: 1, outcome: "reopened", surface: "cli" },
    ]);
  });

  test("an open ISC is reported as already open and left alone", async () => {
    seed("- [ ] ISC-1: open");

    expect(await projectCliJson("reopen-isc", "demo", "1")).toEqual({
      checked: false,
      id: 1,
      alreadyOpen: true,
    });
    expectUntouched("- [ ] ISC-1: open");
    expect(commitmentEvents(home())).toEqual([]);
  });

  test("a missing ISC exits 1 naming the project", async () => {
    seed("- [ ] ISC-1: open");
    const run = await projectCli("reopen-isc", "demo", "4");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`ISC-4 not found in project "demo"\n`);
  });
});

describe("list-isc", () => {
  const criteria = "- [ ] ISC-1: open one\n- [x] ISC-2: legacy done";
  const changelog = "### Archived 2026-01-01\n- [x] ISC-3: done\n- [~] ISC-4: dropped";
  const open = { id: 1, text: "open one", status: "open" };
  const done = [
    { id: 2, text: "legacy done", status: "done" },
    { id: 3, text: "done", status: "done" },
  ];
  const retired = { id: 4, text: "dropped", status: "retired" };
  const counts = { name: "demo", total: 4, open: 1, done: 2, retired: 1 };

  test.each([
    [[], [open]],
    [["--all"], [open, ...done, retired]],
    [["--closed"], done],
    [["--retired"], [retired]],
  ])("flags %p select their ISCs", async (flags, iscs) => {
    seed(criteria, changelog);

    expect(await projectCliJson("list-isc", "demo", ...flags)).toEqual({
      ...counts,
      iscs,
    });
  });

  test("two selection flags cannot be combined", async () => {
    seed(criteria, changelog);
    const run = await projectCli("list-isc", "demo", "--all", "--closed");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      "error: --all and --closed cannot be combined; pick one"
    );
  });
});

describe("show-isc", () => {
  test.each([
    [1, "open", "open one"],
    [3, "done", "archived one"],
  ])("prints ISC-%p from wherever it lives", async (id, status, text) => {
    seed("- [ ] ISC-1: open one", "### Archived 2026-01-01\n- [x] ISC-3: archived one");

    expect(await projectCliJson("show-isc", "demo", String(id))).toEqual({
      name: "demo",
      id,
      status,
      text,
    });
  });

  test("a missing ISC exits 1", async () => {
    seed("- [ ] ISC-1: open one");
    const run = await projectCli("show-isc", "demo", "2");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`ISC-2 not found in project "demo".\n`);
  });
});

describe("retire-isc", () => {
  test("files the ISC under a dated Retired heading as [~]", async () => {
    seed("- [ ] ISC-1: stale\n- [ ] ISC-2: keep");

    expect(await projectCliJson("retire-isc", "demo", "1")).toEqual({
      retired: true,
      id: 1,
      supersededBy: null,
      archived: true,
    });
    expect(stored().criteria).toBe("- [ ] ISC-2: keep");
    expect(stored().changelog).toBe(`### Retired ${today()}\n- [~] ISC-1: stale`);
    expectTouched();
    expect(commitmentEvents(home())).toEqual([
      { iscProject: "demo", isc: 1, outcome: "dropped", surface: "cli" },
    ]);
  });

  test("--by names the superseding ISC on the archived line", async () => {
    seed("- [x] ISC-1: stale\n- [ ] ISC-2: keep");

    expect(await projectCliJson("retire-isc", "demo", "1", "--by", "2")).toMatchObject({
      supersededBy: 2,
    });
    expect(stored().changelog).toBe(
      `### Retired ${today()}\n- [~] ISC-1: stale (superseded by ISC-2)`
    );
  });

  test("an already retired ISC is reported and left alone", async () => {
    seed("- [ ] ISC-2: keep", "### Retired 2026-01-01\n- [~] ISC-1: stale");

    expect(await projectCliJson("retire-isc", "demo", "1")).toEqual({
      retired: true,
      id: 1,
      alreadyRetired: true,
    });
    expectUntouched("- [ ] ISC-2: keep");
    expect(commitmentEvents(home())).toEqual([]);
  });

  test("another retired ISC does not count as this one", async () => {
    seed("- [ ] ISC-1: stale", "### Retired 2026-01-01\n- [~] ISC-2: other");

    expect(await projectCliJson("retire-isc", "demo", "1")).toMatchObject({
      archived: true,
    });
  });

  test("an ISC archived as done is not open to retire", async () => {
    seed("", "### Archived 2026-01-01\n- [x] ISC-1: done");
    const run = await projectCli("retire-isc", "demo", "1");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`ISC-1 not found in project "demo"\n`);
  });

  test("--by must be a positive integer", async () => {
    seed("- [ ] ISC-1: stale");
    const run = await projectCli("retire-isc", "demo", "1", "--by", "0");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`error: --by must be a positive integer, got "0"`);
    expectUntouched("- [ ] ISC-1: stale");
  });
});

describe("edit-isc", () => {
  test("rewrites an open ISC in Criteria and returns the old text", async () => {
    seed("- [ ] ISC-1: old words\n- [ ] ISC-10: neighbour");

    expect(await projectCliJson("edit-isc", "demo", "1", "new", "words")).toEqual({
      edited: true,
      id: 1,
      status: "open",
      previous: "old words",
      text: "new words",
    });
    expect(stored().criteria).toBe("- [ ] ISC-1: new words\n- [ ] ISC-10: neighbour");
    expectTouched();
  });

  test("keeps the box of an archived ISC and leaves Criteria alone", async () => {
    seed(
      "- [ ] ISC-2: open",
      "### Archived 2026-01-01\n- [x] ISC-1: done\n- [~] ISC-3: gone"
    );

    expect(await projectCliJson("edit-isc", "demo", "3", "line\ntwo")).toMatchObject({
      status: "retired",
    });
    expect(stored().criteria).toBe("- [ ] ISC-2: open");
    expect(stored().changelog).toBe(
      String.raw`### Archived 2026-01-01
- [x] ISC-1: done
- [~] ISC-3: line\ntwo`
    );
  });

  test("matches a loosely spaced or uppercase box", async () => {
    seed("-  [X]  ISC-1: shouty");
    await projectCliJson("edit-isc", "demo", "1", "calm");

    expect(stored().criteria).toBe("- [x] ISC-1: calm");
  });

  test("blank text is a usage error", async () => {
    seed("- [ ] ISC-1: old");
    const run = await projectCli("edit-isc", "demo", "1", " ");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("error: <text...> is empty");
    expectUntouched("- [ ] ISC-1: old");
  });

  test("a missing ISC exits 1", async () => {
    seed("- [ ] ISC-1: old");
    const run = await projectCli("edit-isc", "demo", "2", "new");

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`ISC-2 not found in project "demo".\n`);
  });
});

describe("prune-isc", () => {
  test("archives every closed ISC left in Criteria", async () => {
    seed("- [x] ISC-1: done\n- [ ] ISC-2: open\n- [~] ISC-3: gone");

    expect(await projectCliJson("prune-isc", "demo")).toEqual({
      pruned: 2,
      name: "demo",
      remaining_open: 1,
    });
    expect(stored().criteria).toBe("- [ ] ISC-2: open");
    expect(stored().changelog).toBe(
      `### Archived ${today()}\n- [x] ISC-1: done\n- [~] ISC-3: gone`
    );
    expectTouched();
  });

  test("leaves the record untouched when nothing is closed", async () => {
    seed("- [ ] ISC-1: open");

    expect(await projectCliJson("prune-isc", "demo")).toEqual({
      pruned: 0,
      name: "demo",
      remaining_open: 1,
    });
    expectUntouched("- [ ] ISC-1: open");
  });

  test("counts an uppercase box it cannot move and keeps going", async () => {
    seed("- [X] ISC-1: shouty\n- [x] ISC-2: done");

    expect(await projectCliJson("prune-isc", "demo")).toMatchObject({
      pruned: 2,
      remaining_open: 0,
    });
    expect(stored().criteria).toBe("- [X] ISC-1: shouty");
    expect(stored().changelog).toBe(`### Archived ${today()}\n- [x] ISC-2: done`);
  });
});

describe("help", () => {
  test("lists every ISC command with its arguments and summary", async () => {
    const { stdout } = await projectCli("--help");

    for (const [usage, summary] of [
      ["add-isc <name> <title...>", "Append a new open ISC to Criteria"],
      ["complete-isc <name> <id>", "Mark ISC-N as done"],
      ["reopen-isc <name> <id>", "Reopen ISC-N (mark not done)"],
      ["list-isc <name>", "List open ISCs (default), or the closed or retired ones"],
      ["show-isc <name> <id>", "Print one ISC's full text"],
      [
        "edit-isc <name> <id> <text...>",
        "Rewrite ISC-N's text, keeping its id and state",
      ],
      ["retire-isc <name> <id>", "Close ISC-N as no longer valid, not as done"],
      ["prune-isc <name>", "Archive done ISCs from Criteria into the Changelog"],
      ["scaffold-task-isa <title...>", "Create a one-shot task ISA in memory/work/"],
      ["complete-task-isa <slug>", "Mark a task ISA as complete"],
    ]) {
      expect(stdout).toMatch(
        new RegExp(`${RegExp.escape(usage)} +${RegExp.escape(summary)}`)
      );
    }
  });

  test.each([
    [
      "list-isc",
      ["--all +Open, done and retired", "--closed +Done only", "--retired +Retired only"],
    ],
    ["retire-isc", ["--by <id> +The ISC that supersedes it"]],
  ])("%s documents its options", async (command, options) => {
    const { stdout } = await projectCli(command, "--help");

    for (const option of options) expect(stdout).toMatch(new RegExp(option));
  });
});
