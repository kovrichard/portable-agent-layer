import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const TEST_HOME = resolve(import.meta.dir, "../.test-home-project-cli");
const CLI = resolve(import.meta.dir, "../src/tools/agent/project.ts");

beforeAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
});

beforeEach(() => {
  const isaDir = resolve(TEST_HOME, "memory", "projects");
  if (existsSync(isaDir)) rmSync(isaDir, { recursive: true });
  const legacyDir = resolve(TEST_HOME, "memory", "state", "progress");
  if (existsSync(legacyDir)) rmSync(legacyDir, { recursive: true });
});

async function runCli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { ...process.env, PAL_HOME: TEST_HOME },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function isaFiles(): string[] {
  const base = resolve(TEST_HOME, "memory", "projects");
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((slug) => existsSync(resolve(base, slug, "ISA.md")));
}

// Read a named ISA.md body section straight from disk. resume no longer exposes
// the raw Criteria/Changelog blobs (it projects a lean view), so storage-format
// assertions read the file directly, mirroring the production `^## ` split.
function section(slug: string, heading: string): string {
  const isa = readFileSync(
    resolve(TEST_HOME, "memory", "projects", slug, "ISA.md"),
    "utf-8"
  );
  const hit = isa.split(/^## /m).find((part) => part.startsWith(`${heading}\n`));
  return hit ? hit.slice(heading.length).trim() : "";
}

describe("project CLI", () => {
  test("help prints usage", async () => {
    const r = await runCli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Project — manage PAL project state");
    expect(r.stdout).toContain("create");
    expect(r.stdout).toContain("update-section");
  });

  test("create with explicit name + path → writes ISA.md", async () => {
    const r = await runCli(["create", "pal", "--path", "/tmp/pal-fake"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.created).toBe(true);
    expect(out.project.name).toBe("pal");
    expect(out.project.status).toBe("active");
    expect(isaFiles()).toContain("pal");
  });

  test("create defaults the name to basename of cwd (full segment, NOT split)", async () => {
    const fakeRepo = resolve(TEST_HOME, "portable-agent-layer-fixture");
    mkdirSync(fakeRepo, { recursive: true });
    const proc = Bun.spawn(["bun", "run", CLI, "create"], {
      cwd: fakeRepo,
      env: { ...process.env, PAL_HOME: TEST_HOME },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const out = JSON.parse(stdout);
    expect(out.project.name).toBe("portable-agent-layer-fixture");
  });

  test("create rejects duplicate names", async () => {
    await runCli(["create", "dup", "--path", "/tmp/x"]);
    const r = await runCli(["create", "dup", "--path", "/tmp/x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("already exists");
  });

  test("list shows created projects", async () => {
    await runCli(["create", "alpha", "--path", "/tmp/a"]);
    await runCli(["create", "beta", "--path", "/tmp/b"]);
    const r = await runCli(["list"]);
    const out = JSON.parse(r.stdout);
    expect(out.count).toBe(2);
    expect(out.projects.map((p: { name: string }) => p.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("update-section sets a body section, round-trips via resume", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["update-section", "p", "goal", "Ship Tier 1"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.updated).toBe(true);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.goal).toBe("Ship Tier 1");
  });

  test("update-section sets context section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["update-section", "p", "context", "PAI source: /repos/pai"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.section).toBe("context");
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.context).toBe("PAI source: /repos/pai");
  });

  test("add-decision appends dated entry to decisions section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-decision", "p", "use-bm25", "small-corpus-makes-it-fine"]);
    const r = await runCli(["resume", "p"]);
    const got = JSON.parse(r.stdout);
    expect(got.project.decisions).toContain("use-bm25");
    expect(got.project.decisions).toContain("small-corpus-makes-it-fine");
  });

  test("add-decision appends multiple dated entries", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-decision", "p", "decision-one", "reason-one"]);
    await runCli(["add-decision", "p", "decision-two", "reason-two"]);
    const r = await runCli(["resume", "p"]);
    const got = JSON.parse(r.stdout);
    expect(got.project.decisions).toContain("decision-one");
    expect(got.project.decisions).toContain("decision-two");
  });

  test("status transitions: complete / archive / pause / unpause", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    let r = await runCli(["pause", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("paused");
    r = await runCli(["unpause", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("active");
    r = await runCli(["complete", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("complete");
    r = await runCli(["archive", "p"]);
    expect(JSON.parse(r.stdout).status).toBe("archived");
  });

  test("add-next appends and persists count", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    const r = await runCli(["add-next", "p", "Ship", "Tier", "1"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.updated).toBe(true);
    expect(got.count).toBe(1);
    const list = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(list.project.next).toEqual(["Ship Tier 1"]);
  });

  test("rm-next by index removes the right entry", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli(["add-next", "p", "first-next"]);
    await runCli(["add-next", "p", "second-next"]);
    const r = await runCli(["rm-next", "p", "0"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.removed).toBe("first-next");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.next).toEqual(["second-next"]);
  });

  test("criteria returns the criteria section", async () => {
    await runCli(["create", "p", "--path", "/tmp/p"]);
    await runCli([
      "update-section",
      "p",
      "criteria",
      "- All tests pass\n- ISA.md written",
    ]);
    const r = await runCli(["criteria", "p"]);
    expect(r.code).toBe(0);
    const got = JSON.parse(r.stdout);
    expect(got.criteria).toContain("All tests pass");
  });

  test("migrate converts old JSON files to ISA.md and preserves source", async () => {
    const oldDir = resolve(TEST_HOME, "memory", "state", "progress");
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });
    const legacy = {
      name: "legacy-proj",
      path: "/tmp/legacy",
      status: "active",
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-02T00:00:00Z",
      facts: ["ref at ~/pai"],
      objectives: ["Ship it"],
      next_steps: ["do the thing"],
      blockers: ["waiting on review"],
      handoff: "pick up at step 3",
      decisions: [
        { ts: "2026-01-01T00:00:00Z", decision: "use ISA", rationale: "clean" },
      ],
    };
    writeFileSync(resolve(oldDir, "legacy-proj.json"), JSON.stringify(legacy));

    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.migrated).toBe(1);
    expect(out.skipped).toBe(0);

    // Old JSON preserved (migrate never deletes source)
    expect(existsSync(resolve(oldDir, "legacy-proj.json"))).toBe(true);
    // New ISA.md created with migrated data
    expect(isaFiles()).toContain("legacy-proj");
    const resumed = JSON.parse((await runCli(["resume", "legacy-proj"])).stdout);
    expect(resumed.project.next).toEqual(["do the thing"]);
    expect(resumed.project.blockers).toEqual(["waiting on review"]);
    expect(resumed.project.handoff).toBe("pick up at step 3");
    expect(resumed.project.context).toContain("ref at ~/pai");
    expect(resumed.project.goal).toContain("Ship it");
    expect(resumed.project.decisions).toContain("use ISA");
  });

  test("migrate skips already-migrated projects", async () => {
    await runCli(["create", "existing", "--path", "/tmp/existing"]);
    const oldDir = resolve(TEST_HOME, "memory", "state", "progress");
    if (!existsSync(oldDir)) mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      resolve(oldDir, "existing.json"),
      JSON.stringify({
        name: "existing",
        path: "/tmp/existing",
        status: "active",
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
      })
    );
    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.skipped).toBe(1);
    // JSON still present (not deleted since we skipped)
    expect(existsSync(resolve(oldDir, "existing.json"))).toBe(true);
  });

  test("migrate with empty old dir returns zero counts", async () => {
    const r = await runCli(["migrate"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.migrated).toBe(0);
    expect(out.skipped).toBe(0);
  });

  test("invalid name is rejected", async () => {
    const r = await runCli(["create", "Has Spaces", "--path", "/tmp/x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Invalid project name");
  });

  test("set-path updates the registered path", async () => {
    await runCli(["create", "p", "--path", "/tmp/original"]);
    const r = await runCli(["set-path", "p", "/tmp/updated"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.updated).toBe(true);
    expect(out.path).toContain("updated");
    const after = JSON.parse((await runCli(["resume", "p"])).stdout);
    expect(after.project.path).toContain("updated");
  });

  test("unknown command exits 1 with helpful stderr", async () => {
    const r = await runCli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Unknown command");
  });

  test("list-isc defaults to open ISCs only; --all / --closed reveal done ones", async () => {
    await runCli(["create", "iscproj", "--path", "/tmp/iscproj-fake"]);
    await runCli(["add-isc", "iscproj", "first thing"]);
    await runCli(["add-isc", "iscproj", "second thing"]);
    await runCli(["complete-isc", "iscproj", "1"]);

    const def = JSON.parse((await runCli(["list-isc", "iscproj"])).stdout);
    expect(def.total).toBe(2);
    expect(def.open).toBe(1);
    expect(def.done).toBe(1);
    expect(def.iscs).toHaveLength(1);
    expect(def.iscs[0].id).toBe(2);
    expect(def.iscs.every((i: { status: string }) => i.status === "open")).toBe(true);

    const all = JSON.parse((await runCli(["list-isc", "iscproj", "--all"])).stdout);
    expect(all.iscs).toHaveLength(2);

    const closed = JSON.parse((await runCli(["list-isc", "iscproj", "--closed"])).stdout);
    expect(closed.iscs).toHaveLength(1);
    expect(closed.iscs[0].id).toBe(1);
    expect(closed.iscs[0].status).toBe("done");
  });

  test("complete-isc moves the line out of Criteria into the Changelog", async () => {
    await runCli(["create", "arch", "--path", "/tmp/arch-fake"]);
    await runCli(["add-isc", "arch", "ship it"]);
    const done = JSON.parse((await runCli(["complete-isc", "arch", "1"])).stdout);
    expect(done.checked).toBe(true);
    expect(done.archived).toBe(true);

    expect(section("arch", "Criteria")).not.toContain("ISC-1");
    const changelog = section("arch", "Changelog");
    expect(changelog).toContain("### Archived");
    expect(changelog).toContain("[x] ISC-1: ship it");
  });

  test("archived ISC ids are never reused by add-isc", async () => {
    await runCli(["create", "reuse", "--path", "/tmp/reuse-fake"]);
    await runCli(["add-isc", "reuse", "first"]);
    await runCli(["complete-isc", "reuse", "1"]); // ISC-1 leaves Criteria
    const added = JSON.parse((await runCli(["add-isc", "reuse", "second"])).stdout);
    expect(added.id).toBe(2); // not 1, even though Criteria is empty of ISCs
  });

  test("reopen-isc pulls an archived ISC back into the open set", async () => {
    await runCli(["create", "reopen", "--path", "/tmp/reopen-fake"]);
    await runCli(["add-isc", "reopen", "the thing"]);
    await runCli(["complete-isc", "reopen", "1"]);
    const back = JSON.parse((await runCli(["reopen-isc", "reopen", "1"])).stdout);
    expect(back.checked).toBe(false);

    expect(section("reopen", "Criteria")).toContain("[ ] ISC-1: the thing");
    expect(section("reopen", "Changelog")).not.toContain("ISC-1");
    // Reopening the only archived ISC must not leave a dangling empty date heading.
    expect(section("reopen", "Changelog")).not.toContain("### Archived");

    const list = JSON.parse((await runCli(["list-isc", "reopen"])).stdout);
    expect(list.open).toBe(1);
    expect(list.done).toBe(0);
  });

  test("reopen drops the emptied date heading but keeps other dates intact", async () => {
    await runCli(["create", "heads", "--path", "/tmp/heads-fake"]);
    // Two ISCs archived on the same (today's) date, then reopen one.
    await runCli(["add-isc", "heads", "alpha"]);
    await runCli(["add-isc", "heads", "beta"]);
    await runCli(["complete-isc", "heads", "1"]);
    await runCli(["complete-isc", "heads", "2"]);
    await runCli(["reopen-isc", "heads", "1"]);

    const changelog = section("heads", "Changelog");
    // Heading stays because ISC-2 is still filed under it.
    expect(changelog).toContain("### Archived");
    expect(changelog).toContain("[x] ISC-2: beta");
    expect(changelog).not.toContain("ISC-1");
    // Exactly one heading, not a duplicate or orphan.
    expect(changelog.match(/### Archived/g)).toHaveLength(1);
  });

  test("prune-isc backfills legacy done ISCs sitting in Criteria", async () => {
    await runCli(["create", "prune", "--path", "/tmp/prune-fake"]);
    // Simulate a legacy project: done ISCs written directly into Criteria.
    await runCli([
      "update-section",
      "prune",
      "criteria",
      "- [x] ISC-1: old done\n- [ ] ISC-2: still open\n- [x] ISC-3: also done",
    ]);
    const pruned = JSON.parse((await runCli(["prune-isc", "prune"])).stdout);
    expect(pruned.pruned).toBe(2);
    expect(pruned.remaining_open).toBe(1);

    const criteria = section("prune", "Criteria");
    expect(criteria).toContain("[ ] ISC-2: still open");
    expect(criteria).not.toContain("ISC-1");
    expect(criteria).not.toContain("ISC-3");
    const changelog = section("prune", "Changelog");
    expect(changelog).toContain("[x] ISC-1: old done");
    expect(changelog).toContain("[x] ISC-3: also done");

    const list = JSON.parse((await runCli(["list-isc", "prune", "--closed"])).stdout);
    expect(list.iscs).toHaveLength(2);
  });

  test("resume projects a lean view: open-ISC titles, no raw criteria/changelog", async () => {
    await runCli(["create", "lean", "--path", "/tmp/lean-fake"]);
    await runCli(["add-isc", "lean", "first open thing"]);
    await runCli(["add-isc", "lean", "second thing"]);
    await runCli(["complete-isc", "lean", "2"]); // archived into Changelog
    const project = JSON.parse((await runCli(["resume", "lean"])).stdout).project;
    // The raw blobs are dropped — that IS the projection.
    expect(project.criteria).toBeUndefined();
    expect(project.changelog).toBeUndefined();
    // Open ISCs surface as {id, title}; closed ones only as a count.
    expect(project.open_iscs).toEqual([{ id: 1, title: "first open thing" }]);
    expect(project.isc_summary).toEqual({ open: 1, done: 1, retired: 0 });
  });

  test("resume truncates a long ISC line to a glanceable title", async () => {
    await runCli(["create", "trunc", "--path", "/tmp/trunc-fake"]);
    await runCli([
      "add-isc",
      "trunc",
      "short lead; then a long tail dropped from the title",
    ]);
    const project = JSON.parse((await runCli(["resume", "trunc"])).stdout).project;
    expect(project.open_iscs[0].title).toBe("short lead");
  });

  test("show-isc returns the full text of an open ISC", async () => {
    await runCli(["create", "show", "--path", "/tmp/show-fake"]);
    const full = "detailed body; with clauses and (parens) and more";
    await runCli(["add-isc", "show", full]);
    const r = await runCli(["show-isc", "show", "1"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      name: "show",
      id: 1,
      status: "open",
      text: full,
    });
  });

  test("show-isc finds an archived (closed) ISC too", async () => {
    await runCli(["create", "showc", "--path", "/tmp/showc-fake"]);
    await runCli(["add-isc", "showc", "will be done"]);
    await runCli(["complete-isc", "showc", "1"]);
    const got = JSON.parse((await runCli(["show-isc", "showc", "1"])).stdout);
    expect(got.status).toBe("done");
    expect(got.text).toBe("will be done");
  });

  test("show-isc fails on an unknown id", async () => {
    await runCli(["create", "shownone", "--path", "/tmp/shownone-fake"]);
    const r = await runCli(["show-isc", "shownone", "99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ISC-99 not found");
  });

  test("edit-isc rewrites the text, keeping the id and open state", async () => {
    await runCli(["create", "edit", "--path", "/tmp/edit-fake"]);
    await runCli(["add-isc", "edit", "vague wording"]);

    const r = await runCli([
      "edit-isc",
      "edit",
      "1",
      "sharp wording with a done-condition",
    ]);

    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      edited: true,
      id: 1,
      status: "open",
      previous: "vague wording",
      text: "sharp wording with a done-condition",
    });
    expect(section("edit", "Criteria")).toContain(
      "- [ ] ISC-1: sharp wording with a done-condition"
    );
    expect(section("edit", "Criteria")).not.toContain("vague wording");
  });

  /**
   * An ISC is one markdown line. Before this was encoded, a paragraph break
   * ended the record and every paragraph after it was stranded in the file as
   * unparseable debris — silently, because the command echoed back the text it
   * had been handed rather than the text it stored.
   */
  const MULTI = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";

  test("add-isc keeps every paragraph of a multi-paragraph ISC", async () => {
    await runCli(["create", "multi", "--path", "/tmp/multi-fake"]);
    await runCli(["add-isc", "multi", MULTI]);

    const shown = JSON.parse((await runCli(["show-isc", "multi", "1"])).stdout);
    expect(shown.text).toBe(MULTI);
  });

  test("edit-isc keeps every paragraph of a multi-paragraph ISC", async () => {
    await runCli(["create", "multie", "--path", "/tmp/multie-fake"]);
    await runCli(["add-isc", "multie", "one line"]);
    await runCli(["edit-isc", "multie", "1", MULTI]);

    const shown = JSON.parse((await runCli(["show-isc", "multie", "1"])).stdout);
    expect(shown.text).toBe(MULTI);
  });

  test("a multi-paragraph ISC still occupies exactly one line in the file", async () => {
    await runCli(["create", "oneline", "--path", "/tmp/oneline-fake"]);
    await runCli(["add-isc", "oneline", MULTI]);

    const iscLines = section("oneline", "Criteria")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(iscLines).toEqual([
      "- [ ] ISC-1: First paragraph.\\n\\nSecond paragraph.\\n\\nThird paragraph.",
    ]);
  });

  test("a literal backslash-n in an ISC is not decoded into a line break", async () => {
    await runCli(["create", "esc", "--path", "/tmp/esc-fake"]);
    const withRegex = String.raw`deny pattern: kubectl\s+prod and a literal \n sequence`;
    await runCli(["add-isc", "esc", withRegex]);

    const shown = JSON.parse((await runCli(["show-isc", "esc", "1"])).stdout);
    expect(shown.text).toBe(withRegex);
    expect(shown.text).not.toContain("\n");
  });

  test("a multi-paragraph ISC survives being completed and shown from the Changelog", async () => {
    await runCli(["create", "multidone", "--path", "/tmp/multidone-fake"]);
    await runCli(["add-isc", "multidone", MULTI]);
    await runCli(["complete-isc", "multidone", "1"]);

    const shown = JSON.parse((await runCli(["show-isc", "multidone", "1"])).stdout);
    expect(shown.text).toBe(MULTI);
  });

  test("edit-isc keeps a closed ISC closed and in the Changelog", async () => {
    await runCli(["create", "editc", "--path", "/tmp/editc-fake"]);
    await runCli(["add-isc", "editc", "before"]);
    await runCli(["complete-isc", "editc", "1"]);

    const got = JSON.parse((await runCli(["edit-isc", "editc", "1", "after"])).stdout);

    expect(got.status).toBe("done");
    expect(section("editc", "Changelog")).toContain("- [x] ISC-1: after");
    expect(section("editc", "Criteria")).not.toContain("ISC-1");
  });

  test("edit-isc leaves sibling ISCs untouched", async () => {
    await runCli(["create", "editsib", "--path", "/tmp/editsib-fake"]);
    await runCli(["add-isc", "editsib", "first"]);
    await runCli(["add-isc", "editsib", "second"]);

    await runCli(["edit-isc", "editsib", "1", "rewritten"]);

    const criteria = section("editsib", "Criteria");
    expect(criteria).toContain("- [ ] ISC-1: rewritten");
    expect(criteria).toContain("- [ ] ISC-2: second");
  });

  test("an edited id is still reserved against reuse", async () => {
    await runCli(["create", "editres", "--path", "/tmp/editres-fake"]);
    await runCli(["add-isc", "editres", "first"]);
    await runCli(["edit-isc", "editres", "1", "first, reworded"]);

    const added = JSON.parse((await runCli(["add-isc", "editres", "second"])).stdout);

    expect(added.id).toBe(2);
  });

  test("edit-isc fails on an unknown id", async () => {
    await runCli(["create", "editnone", "--path", "/tmp/editnone-fake"]);
    const r = await runCli(["edit-isc", "editnone", "99", "nope"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ISC-99 not found");
  });

  test("edit-isc requires replacement text", async () => {
    await runCli(["create", "editempty", "--path", "/tmp/editempty-fake"]);
    await runCli(["add-isc", "editempty", "keep me"]);

    const r = await runCli(["edit-isc", "editempty", "1", "   "]);

    expect(r.code).toBe(1);
    expect(section("editempty", "Criteria")).toContain("keep me");
  });

  test("retire-isc files the ISC under Retired, not Archived", async () => {
    await runCli(["create", "ret", "--path", "/tmp/ret-fake"]);
    await runCli(["add-isc", "ret", "no longer valid"]);

    const r = await runCli(["retire-isc", "ret", "1"]);

    expect(r.code).toBe(0);
    const changelog = section("ret", "Changelog");
    expect(changelog).toContain("### Retired");
    expect(changelog).toContain("- [~] ISC-1: no longer valid");
    expect(changelog).not.toContain("### Archived");
    expect(section("ret", "Criteria")).not.toContain("ISC-1");
  });

  test("retire-isc records the superseding id with --by", async () => {
    await runCli(["create", "retby", "--path", "/tmp/retby-fake"]);
    await runCli(["add-isc", "retby", "old framing"]);
    await runCli(["add-isc", "retby", "new framing"]);

    const got = JSON.parse(
      (await runCli(["retire-isc", "retby", "1", "--by", "2"])).stdout
    );

    expect(got.supersededBy).toBe(2);
    expect(section("retby", "Changelog")).toContain("(superseded by ISC-2)");
  });

  test("a retired id is never reused by add-isc", async () => {
    await runCli(["create", "retres", "--path", "/tmp/retres-fake"]);
    await runCli(["add-isc", "retres", "first"]);
    await runCli(["retire-isc", "retres", "1"]);

    const added = JSON.parse((await runCli(["add-isc", "retres", "second"])).stdout);

    expect(added.id).toBe(2);
  });

  test("a retired ISC counts as neither open nor done", async () => {
    await runCli(["create", "retcount", "--path", "/tmp/retcount-fake"]);
    await runCli(["add-isc", "retcount", "stays open"]);
    await runCli(["add-isc", "retcount", "gets done"]);
    await runCli(["add-isc", "retcount", "gets retired"]);
    await runCli(["complete-isc", "retcount", "2"]);
    await runCli(["retire-isc", "retcount", "3"]);

    const listed = JSON.parse((await runCli(["list-isc", "retcount"])).stdout);

    expect(listed.open).toBe(1);
    expect(listed.done).toBe(1);
    expect(listed.retired).toBe(1);
    expect(listed.iscs.map((i: { id: number }) => i.id)).toEqual([1]);
  });

  test("resume excludes retired ISCs from open work", async () => {
    await runCli(["create", "retres2", "--path", "/tmp/retres2-fake"]);
    await runCli(["add-isc", "retres2", "live work"]);
    await runCli(["add-isc", "retres2", "dead work"]);
    await runCli(["retire-isc", "retres2", "2"]);

    const got = JSON.parse((await runCli(["resume", "retres2"])).stdout);

    expect(got.project.open_iscs.map((i: { id: number }) => i.id)).toEqual([1]);
    expect(got.project.isc_summary).toEqual({ open: 1, done: 0, retired: 1 });
  });

  test("list-isc --retired returns only retired, --all includes them", async () => {
    await runCli(["create", "retflag", "--path", "/tmp/retflag-fake"]);
    await runCli(["add-isc", "retflag", "open one"]);
    await runCli(["add-isc", "retflag", "retired one"]);
    await runCli(["retire-isc", "retflag", "2"]);

    const only = JSON.parse((await runCli(["list-isc", "retflag", "--retired"])).stdout);
    const all = JSON.parse((await runCli(["list-isc", "retflag", "--all"])).stdout);

    expect(only.iscs.map((i: { id: number }) => i.id)).toEqual([2]);
    expect(all.iscs.map((i: { id: number }) => i.id).sort()).toEqual([1, 2]);
  });

  test("show-isc reports retired status", async () => {
    await runCli(["create", "retshow", "--path", "/tmp/retshow-fake"]);
    await runCli(["add-isc", "retshow", "gone"]);
    await runCli(["retire-isc", "retshow", "1"]);

    const got = JSON.parse((await runCli(["show-isc", "retshow", "1"])).stdout);

    expect(got.status).toBe("retired");
    expect(got.text).toBe("gone");
  });

  test("reopen-isc brings a retired ISC back to open", async () => {
    await runCli(["create", "retreopen", "--path", "/tmp/retreopen-fake"]);
    await runCli(["add-isc", "retreopen", "back from the dead"]);
    await runCli(["retire-isc", "retreopen", "1"]);

    await runCli(["reopen-isc", "retreopen", "1"]);

    expect(section("retreopen", "Criteria")).toContain("- [ ] ISC-1: back from the dead");
    expect(section("retreopen", "Changelog")).not.toContain("ISC-1");
  });

  test("edit-isc preserves the retired state", async () => {
    await runCli(["create", "retedit", "--path", "/tmp/retedit-fake"]);
    await runCli(["add-isc", "retedit", "before"]);
    await runCli(["retire-isc", "retedit", "1"]);

    const got = JSON.parse((await runCli(["edit-isc", "retedit", "1", "after"])).stdout);

    expect(got.status).toBe("retired");
    expect(section("retedit", "Changelog")).toContain("- [~] ISC-1: after");
  });

  test("retire-isc fails on an unknown id", async () => {
    await runCli(["create", "retnone", "--path", "/tmp/retnone-fake"]);
    const r = await runCli(["retire-isc", "retnone", "99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ISC-99 not found");
  });

  test("complete-isc still archives as done, unaffected by retire", async () => {
    await runCli(["create", "retdone", "--path", "/tmp/retdone-fake"]);
    await runCli(["add-isc", "retdone", "genuinely finished"]);
    await runCli(["complete-isc", "retdone", "1"]);

    const changelog = section("retdone", "Changelog");
    expect(changelog).toContain("### Archived");
    expect(changelog).toContain("- [x] ISC-1: genuinely finished");
    expect(changelog).not.toContain("[~]");
  });

  describe("what a project serves", () => {
    function frontmatter(slug: string): string {
      return readFileSync(
        resolve(TEST_HOME, "memory", "projects", slug, "ISA.md"),
        "utf-8"
      );
    }

    test("create takes the answer and records it as the user's", async () => {
      await runCli([
        "create",
        "servcreate",
        "--path",
        "/tmp/servcreate-fake",
        "--serves",
        "revenue",
        "--serves-note",
        "a SaaS bet",
      ]);
      const raw = frontmatter("servcreate");
      expect(raw).toContain('serves: "revenue"');
      expect(raw).toContain('serves_by: "user"');
      expect(raw).toContain('serves_note: "a SaaS bet"');
    });

    test("create without the flag leaves the record unranked", async () => {
      await runCli(["create", "servnone", "--path", "/tmp/servnone-fake"]);
      expect(frontmatter("servnone")).not.toContain("serves:");
    });

    test("create refuses a kind outside the three", async () => {
      const r = await runCli([
        "create",
        "servbad",
        "--path",
        "/tmp/servbad-fake",
        "--serves",
        "important",
      ]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("goal, revenue, fun");
      expect(isaFiles()).not.toContain("servbad");
    });

    test("serves sets it after the fact, note and all", async () => {
      await runCli(["create", "servlater", "--path", "/tmp/servlater-fake"]);
      const r = await runCli(["serves", "servlater", "goal", "feeds", "the", "pitch"]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({
        project: "servlater",
        serves: "goal",
        by: "user",
      });
      expect(frontmatter("servlater")).toContain('serves_note: "feeds the pitch"');
    });

    test("serves refuses a kind outside the three", async () => {
      await runCli(["create", "servkind", "--path", "/tmp/servkind-fake"]);
      const r = await runCli(["serves", "servkind", "critical"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("goal, revenue, fun");
    });

    test("serves on an unknown project fails rather than creating one", async () => {
      const r = await runCli(["serves", "servghost", "fun"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("servghost");
      expect(isaFiles()).not.toContain("servghost");
    });

    test("serves needs both a name and a kind", async () => {
      const r = await runCli(["serves", "servlonely"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("Usage: serves");
    });
  });
});
