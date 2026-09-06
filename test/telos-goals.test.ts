import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { dueFrom, readTelosGoals } from "../src/hooks/lib/telos-goals";

// GOALS.md is prose written by a person, and the matrix has to rank it without
// a model — so every shape the file actually takes is pinned here.

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-telos-goals-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

function writeGoals(content: string): void {
  mkdirSync(resolve(HOME, "telos"), { recursive: true });
  writeFileSync(resolve(HOME, "telos", "GOALS.md"), content, "utf-8");
}

describe("dueFrom", () => {
  test("an ISO day is taken as written", () => {
    expect(dueFrom("ship it by 2026-11-03 at the latest")).toBe("2026-11-03");
  });

  test("a month and year becomes the last day of that month", () => {
    expect(dueFrom("hired by September 2026")).toBe("2026-09-30");
    expect(dueFrom("done in February 2028")).toBe("2028-02-29");
  });

  test("a quarter becomes the last day of that quarter", () => {
    expect(dueFrom("revenue by Q1 2027")).toBe("2027-03-31");
    expect(dueFrom("launch in Q4, 2026")).toBe("2026-12-31");
  });

  test("an ISO day wins over a month named in the same line", () => {
    expect(dueFrom("2026-10-05, not September 2026")).toBe("2026-10-05");
  });

  test("undated text has no due date", () => {
    expect(dueFrom("find clients")).toBeNull();
  });
});

describe("readTelosGoals", () => {
  test("no file means no goals, not a throw", () => {
    expect(readTelosGoals()).toEqual([]);
  });

  test("bullets under a heading become entries carrying the heading", () => {
    writeGoals(
      "# Goals\n\n## Short-term\n\n- Find three clients by 2026-10-31\n- Ship the deck\n"
    );
    const goals = readTelosGoals();
    expect(goals.map((g) => g.title)).toEqual([
      "Find three clients by 2026-10-31",
      "Ship the deck",
    ]);
    expect(goals[0].horizon).toBe("Short-term");
    expect(goals[0].due).toBe("2026-10-31");
    expect(goals[1].due).toBeNull();
  });

  test("the top-level Goals heading is not itself a horizon", () => {
    writeGoals("# Goals\n\n- Find clients\n");
    expect(readTelosGoals()[0].horizon).toBeNull();
  });

  test("prose with no bullets is one entry per paragraph", () => {
    writeGoals(
      "# Goals\n\nFind clients. Every week, not eventually.\n\nBe hired by September 2026.\n"
    );
    const goals = readTelosGoals();
    expect(goals).toHaveLength(2);
    expect(goals[0].title).toBe("Find clients.");
    expect(goals[0].text).toBe("Find clients. Every week, not eventually.");
    expect(goals[1].due).toBe("2026-09-30");
  });

  test("bullets win over the surrounding prose in the same block", () => {
    writeGoals("# Goals\n\nSome preamble here\n- The actual goal\n");
    expect(readTelosGoals().map((g) => g.title)).toEqual(["The actual goal"]);
  });

  test("comments and horizontal rules are not goals", () => {
    writeGoals("# Goals\n\n<!-- fill this in -->\n\n---\n\n- A real goal\n");
    expect(readTelosGoals().map((g) => g.title)).toEqual(["A real goal"]);
  });

  test("an empty scaffold yields nothing", () => {
    writeGoals("# Goals\n\n## Short-term\n\n## Long-term\n");
    expect(readTelosGoals()).toEqual([]);
  });

  test("a scaffold's empty bullets are punctuation, not goals", () => {
    writeGoals(
      "# Goals\n\n## Short-term\n\n- A real goal\n\n## Medium-term\n\n-\n\n## Long-term\n\n-\n"
    );
    expect(readTelosGoals().map((g) => g.title)).toEqual(["A real goal"]);
  });

  test("ids are stable slugs and never collide on empty titles", () => {
    writeGoals("# Goals\n\n- Find three clients\n- ...\n- ...\n");
    const ids = readTelosGoals().map((g) => g.id);
    expect(ids[0]).toBe("find-three-clients");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
