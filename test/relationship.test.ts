import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendNotes, loadRecentNotes } from "../src/hooks/lib/relationship";

const HOME = resolve(import.meta.dir, "../.test-home-relationship");
const savedHome = process.env.PAL_HOME;

function ymd(offsetDays = 0): { month: string; day: string } {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { month: `${yyyy}-${mm}`, day: `${yyyy}-${mm}-${dd}` };
}

function relDir(): string {
  return resolve(HOME, "memory", "relationship");
}

function todayFile(): string {
  const { month, day } = ymd();
  return resolve(relDir(), month, `${day}.md`);
}

function seed(month: string, day: string, content: string) {
  mkdirSync(resolve(relDir(), month), { recursive: true });
  writeFileSync(resolve(relDir(), month, `${day}.md`), content);
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PAL_HOME;
  else process.env.PAL_HOME = savedHome;
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("appendNotes", () => {
  test("writes nothing when given no notes", () => {
    appendNotes([]);

    expect(existsSync(todayFile())).toBe(false);
  });

  test("creates today's file under memory/relationship/YYYY-MM/", () => {
    appendNotes([{ type: "W", text: "uses bun" }]);

    expect(existsSync(todayFile())).toBe(true);
    expect(readFileSync(todayFile(), "utf-8")).toContain("- W: uses bun");
  });

  test("writes a dated header on the first append only", () => {
    const { day } = ymd();

    appendNotes([{ type: "W", text: "first fact" }]);
    appendNotes([{ type: "W", text: "second fact" }]);

    const content = readFileSync(todayFile(), "utf-8");
    expect(content.match(new RegExp(`# Relationship Notes — ${day}`, "g"))).toHaveLength(
      1
    );
    expect(content).toContain("- W: first fact");
    expect(content).toContain("- W: second fact");
  });

  test("stamps each append with an HH:MM section heading", () => {
    appendNotes([{ type: "Session", text: "did a thing" }]);

    expect(readFileSync(todayFile(), "utf-8")).toMatch(/^## \d{2}:\d{2}$/m);
  });

  test("records the confidence of an opinion note", () => {
    appendNotes([{ type: "O", text: "prefers terse replies", confidence: 0.8 }]);

    expect(readFileSync(todayFile(), "utf-8")).toContain(
      "- O(c=0.8): prefers terse replies"
    );
  });

  test("omits the confidence marker when an opinion has none", () => {
    appendNotes([{ type: "O", text: "prefers terse replies" }]);

    const content = readFileSync(todayFile(), "utf-8");
    expect(content).toContain("- O: prefers terse replies");
    expect(content).not.toContain("c=");
  });

  test("embeds the session id and cwd when given one", () => {
    appendNotes([{ type: "W", text: "a fact" }], "sess-123");

    const content = readFileSync(todayFile(), "utf-8");
    expect(content).toContain("<!-- session:sess-123");
    expect(content).toContain(`cwd:${process.cwd()}`);
  });

  test("omits the session comment when no id is given", () => {
    appendNotes([{ type: "W", text: "a fact" }]);

    expect(readFileSync(todayFile(), "utf-8")).not.toContain("<!-- session:");
  });

  test("anchors the cwd to {proj:slug} when it falls inside a registered project", () => {
    const slug = "test-repo";
    const dir = resolve(HOME, "memory", "projects", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "ISA.md"),
      `---\nname: "${slug}"\npath: "${process.cwd()}"\nstatus: "active"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n## Goal\n`
    );

    appendNotes([{ type: "W", text: "a fact" }], "sess-456");

    const content = readFileSync(todayFile(), "utf-8");
    expect(content).toContain(`cwd:{proj:${slug}}`);
    expect(content).not.toContain(`cwd:${process.cwd()}`);
  });

  test("skips a note whose text is already present", () => {
    appendNotes([{ type: "W", text: "duplicated fact" }]);
    appendNotes([{ type: "W", text: "duplicated fact" }]);

    const content = readFileSync(todayFile(), "utf-8");
    expect(content.match(/duplicated fact/g)).toHaveLength(1);
  });

  test("deduplicates regardless of letter case", () => {
    appendNotes([{ type: "W", text: "Mixed Case Fact" }]);
    appendNotes([{ type: "W", text: "mixed case fact" }]);

    expect(
      readFileSync(todayFile(), "utf-8")
        .toLowerCase()
        .match(/mixed case fact/g)
    ).toHaveLength(1);
  });

  test("keeps a fresh note that arrives alongside a duplicate", () => {
    appendNotes([{ type: "W", text: "already known" }]);
    appendNotes([
      { type: "W", text: "already known" },
      { type: "W", text: "brand new" },
    ]);

    const content = readFileSync(todayFile(), "utf-8");
    expect(content.match(/already known/g)).toHaveLength(1);
    expect(content).toContain("- W: brand new");
  });

  test("adds no new section when every note is a duplicate", () => {
    appendNotes([{ type: "W", text: "only fact" }]);
    const before = readFileSync(todayFile(), "utf-8");

    appendNotes([{ type: "W", text: "only fact" }]);

    expect(readFileSync(todayFile(), "utf-8")).toBe(before);
  });
});

describe("loadRecentNotes", () => {
  test("returns empty when nothing has been recorded", () => {
    expect(loadRecentNotes()).toBe("");
  });

  test("returns today's notes", () => {
    const { month, day } = ymd();
    seed(month, day, "# Today\n- W: fresh");

    expect(loadRecentNotes()).toContain("- W: fresh");
  });

  test("joins several days with a horizontal rule", () => {
    const today = ymd();
    const yesterday = ymd(1);
    seed(today.month, today.day, "TODAY");
    seed(yesterday.month, yesterday.day, "YESTERDAY");

    const loaded = loadRecentNotes(2);

    expect(loaded).toContain("TODAY");
    expect(loaded).toContain("YESTERDAY");
    expect(loaded).toContain("\n\n---\n\n");
  });

  test("excludes a day older than the requested window", () => {
    const today = ymd();
    const old = ymd(10);
    seed(today.month, today.day, "RECENT");
    seed(old.month, old.day, "ANCIENT");

    const loaded = loadRecentNotes(2);

    expect(loaded).toContain("RECENT");
    expect(loaded).not.toContain("ANCIENT");
  });

  test("widens the window when asked for more days", () => {
    const old = ymd(5);
    seed(old.month, old.day, "FIVE-DAYS-BACK");

    expect(loadRecentNotes(2)).not.toContain("FIVE-DAYS-BACK");
    expect(loadRecentNotes(30)).toContain("FIVE-DAYS-BACK");
  });

  test("ignores a directory that is not a YYYY-MM month", () => {
    const { month, day } = ymd();
    seed(month, day, "REAL");
    mkdirSync(resolve(relDir(), "notes-archive"), { recursive: true });
    writeFileSync(resolve(relDir(), "notes-archive", `${day}.md`), "STRAY");

    const loaded = loadRecentNotes();

    expect(loaded).toContain("REAL");
    expect(loaded).not.toContain("STRAY");
  });

  test("ignores non-markdown files in a month directory", () => {
    const { month, day } = ymd();
    seed(month, day, "REAL");
    writeFileSync(resolve(relDir(), month, "notes.txt"), "STRAY");

    expect(loadRecentNotes()).not.toContain("STRAY");
  });

  test("skips an empty note file", () => {
    const today = ymd();
    const yesterday = ymd(1);
    seed(today.month, today.day, "   ");
    seed(yesterday.month, yesterday.day, "HAS CONTENT");

    const loaded = loadRecentNotes(2);

    expect(loaded).toBe("HAS CONTENT");
  });
});
