import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { v18TicketsToLog } from "../src/cli/migrations/v18-tickets-to-log";
import { linesNotIn } from "../src/core/import-merge";
import { readProject } from "../src/progress/projects";
import { freshTestDir } from "./lib/test-home";

const FRONTMATTER =
  '---\nname: "pal"\nstatus: "active"\ncreated: "2026-03-01T00:00:00.000Z"\nupdated: "2026-11-01T00:00:00.000Z"\n---\n\n';

function machine(criteria: string, changelog = ""): string {
  const home = freshTestDir(import.meta.file);
  const dir = resolve(home, "work", "projects", "pal");
  mkdirSync(dir, { recursive: true });
  const sections = [`## Goal\n\nShip.`, `## Criteria\n\n${criteria}`];

  if (changelog) sections.push(`## Changelog\n\n${changelog}`);
  writeFileSync(resolve(dir, "ISA.md"), `${FRONTMATTER}${sections.join("\n\n")}\n`);

  return home;
}

const isaOf = (home: string) =>
  readFileSync(resolve(home, "work", "projects", "pal", "ISA.md"), "utf-8");
const logOf = (home: string) => resolve(home, "work", "projects", "pal", "tickets.jsonl");

function migrate(home: string) {
  process.env.PAL_HOME = home;

  return v18TicketsToLog.run();
}

function syncLogs(from: string, into: string): void {
  const added = linesNotIn(
    readFileSync(logOf(into), "utf-8"),
    readFileSync(logOf(from), "utf-8")
  );
  appendFileSync(logOf(into), added.map((line) => `${line}\n`).join(""));
}

function criteriaOn(home: string): string {
  process.env.PAL_HOME = home;

  return readProject("pal")?.criteria ?? "";
}

describe("v18-tickets-to-log", () => {
  test("moves the ticket lines into the log and leaves the rest of ISA.md", () => {
    const home = machine(
      "- [ ] ISC-1: ship it",
      "### Archived 2026-11-20\n- [x] ISC-2: done"
    );
    process.env.PAL_HOME = home;

    expect(v18TicketsToLog.check()).toEqual({
      pending: true,
      detail: "1 project(s) hold tickets in ISA.md",
    });
    expect(migrate(home)).toEqual({
      migrated: 1,
      skipped: 0,
      results: ["pal: moved 2 ticket(s) to tickets.jsonl"],
    });
    expect(isaOf(home)).toBe(`${FRONTMATTER}## Goal\n\nShip.\n`);
    expect(v18TicketsToLog.check().pending).toBe(false);
    expect(readProject("pal")).toMatchObject({
      criteria: expect.stringMatching(/^- \[ \] ISC-[0-9a-z]{6}: ship it$/),
      changelog: expect.stringMatching(
        /^### Archived 2026-11-20\n- \[x\] ISC-[0-9a-z]{6}: done$/
      ),
    });
  });

  test("a dry run names what it would move and writes nothing", () => {
    const home = machine("- [ ] ISC-1: ship it");
    const before = isaOf(home);
    process.env.PAL_HOME = home;

    expect(v18TicketsToLog.run(true).results).toEqual([
      "pal: would move 1 ticket(s) to tickets.jsonl",
    ]);
    expect(isaOf(home)).toBe(before);
  });

  test("two machines that migrate apart and then sync see each shared ticket once", () => {
    const a = machine("- [ ] ISC-1: shared\n- [ ] ISC-2: only on A");
    const b = machine("- [ ] ISC-1: shared\n- [ ] ISC-2: only on B");
    migrate(a);
    migrate(b);
    syncLogs(b, a);
    syncLogs(a, b);

    expect(isaOf(a)).toBe(isaOf(b));
    expect(criteriaOn(a)).toBe(criteriaOn(b));
    const lines = criteriaOn(a).split("\n");
    expect(lines.filter((line) => line.endsWith(": shared"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes(": only on"))).toHaveLength(2);
    const logged = readFileSync(logOf(a), "utf-8").trim().split("\n");
    expect(logged).toHaveLength(3);
    expect(logged.filter((line) => "at" in JSON.parse(line))).toEqual([]);
  });
});
