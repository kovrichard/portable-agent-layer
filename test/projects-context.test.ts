import { beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type ProjectProgress, writeProject } from "../src/hooks/lib/projects";
import { loadActiveProjectsContext } from "../src/hooks/lib/projects-context";
import { fakeProject, projectsHome } from "./lib/projects-lib-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { outsideRepoHome } from "./lib/test-home";

const HOME = projectsHome(import.meta.file);
const FIXTURES = outsideRepoHome(import.meta.file);
const NOW = new Date("2026-06-01T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HEADER = "## Active Projects\n";

beforeEach(() => {
  removeOnceReleased(resolve(HOME, "bindings.json"));
  removeOnceReleased(FIXTURES);
});

function contextAtNow(
  cwd: string,
  lastSessionTitle?: (project: string) => string | undefined
) {
  setSystemTime(NOW);

  try {
    return loadActiveProjectsContext(cwd, lastSessionTitle);
  } finally {
    setSystemTime();
  }
}

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function folder(rel: string, ...markers: string[]): string {
  const dir = resolve(FIXTURES, rel);
  mkdirSync(dir, { recursive: true });

  for (const marker of markers) mkdirSync(resolve(dir, marker), { recursive: true });

  return dir;
}

function register(name: string, updated: string, over: Partial<ProjectProgress> = {}) {
  writeProject(
    fakeProject({ name, updated, path: undefined, remote: "example.com/r", ...over })
  );
}

function hint(root: string): string {
  return `💡 \`${root}\` looks like a project but isn't registered. If substantive work starts here, suggest registering it via \`pal cli project create\`.`;
}

describe("projects other than the one here", () => {
  test("get one line each, newest first, with age, counts and last session", () => {
    register("zeta", ago(30_000), { next: ["a", "b"], blockers: ["c"] });
    register("alpha", ago(MINUTE), { status: "paused" });
    register("mid", ago(HOUR - 1));
    register("hour", ago(HOUR));
    register("day", ago(DAY));
    register("older", ago(13 * DAY));
    register("q1", ago(20 * DAY));
    register("q2", ago(15 * DAY));
    register("done", ago(0), { status: "complete" });

    const out = contextAtNow(folder("browse"), (p) =>
      p === "zeta" ? "fixed login" : undefined
    );

    expect(out).toBe(
      [
        HEADER,
        "- **zeta** (just now) — 2 next, 1 blockers — last: fixed login",
        "- **alpha** (paused, 1m ago)",
        "- **mid** (59m ago)",
        "- **hour** (today)",
        "- **day** (1d ago)",
        "- **older** (13d ago)",
        "- Quiet for 14+ days: q2, q1",
      ].join("\n")
    );
  });

  test("an unreadable or empty update time shows as a question mark", () => {
    register("bogus", "not a date");
    register("blank", "");

    expect(contextAtNow(folder("browse"))).toBe(
      [HEADER, "- **bogus** (?)", "- **blank** (?)"].join("\n")
    );
  });
});

describe("the project here", () => {
  test("shows its facts, objectives, constraints, next steps and blockers", () => {
    const cwd = folder("full", ".git");
    register("full", ago(29 * DAY), {
      path: cwd,
      context: "- Uses Bun  \nplain well-known fact\n-tight\n   indented\n### Heading",
      goal: "- one  \n\nwell-known two\n-three\n- four",
      constraints: "- no network",
      next: ["n1", "n2", "n3", "n4"],
      blockers: ["b1"],
    });

    expect(contextAtNow(cwd)).toBe(
      [
        HEADER,
        "- **full** (29d ago) ⚠ stale → here",
        "  Facts: Uses Bun; plain well-known fact; tight; indented",
        "  Objectives: one; well-known two; three",
        "  Constraints: no network",
        "  Next: n1; n2; n3",
        "  Blockers: b1",
      ].join("\n")
    );
  });

  test("with nothing recorded shows only its heading line", () => {
    const cwd = folder("bare", ".git");
    register("bare", ago(30 * DAY), { path: cwd, next: [] });

    expect(contextAtNow(cwd)).toBe(
      [HEADER, "- **bare** (1mo ago) ⚠ stale → here"].join("\n")
    );
  });

  test("facts that fit the budget exactly are all shown", () => {
    const cwd = folder("fits", ".git");
    const facts = ["A".repeat(299), "B".repeat(299)];
    register("fits", ago(0), { path: cwd, context: facts.join("\n") });

    expect(contextAtNow(cwd).split("\n")[3]).toBe(`  Facts: ${facts.join("; ")}`);
  });

  test("facts one character over the budget stop and point to the record", () => {
    const cwd = folder("over", ".git");
    const first = "A".repeat(300);
    register("over", ago(0), { path: cwd, context: `${first}\n${"B".repeat(299)}` });

    expect(contextAtNow(cwd).split("\n")[3]).toBe(
      `  Facts: ${first} (more: \`pal cli project resume over\`)`
    );
  });

  test("a nested repository inside it is not offered for registration", () => {
    const parent = folder("parent");
    const nested = folder("parent/nested", ".git");
    register("parent", ago(0), { path: parent });

    expect(contextAtNow(nested)).toBe(
      [HEADER, "- **parent** (just now) → here"].join("\n")
    );
  });
});

describe("the registration hint", () => {
  test("is all that shows for an unregistered repository with no projects", () => {
    const root = folder("lonely", "package.json");

    expect(contextAtNow(folder("lonely/src/lib"))).toBe(hint(root));
  });

  test("follows the project list after a blank line", () => {
    const root = folder("fresh", ".git");
    register("other", ago(0));

    expect(contextAtNow(root)).toBe(
      [HEADER, "- **other** (just now)", "", hint(root)].join("\n")
    );
  });

  test("is not shown for a repository a finished project already owns", () => {
    const root = folder("finished", ".git");
    register("aaa-no-path", ago(0), { status: "complete" });
    register("finished", ago(0), { path: root, status: "complete" });

    expect(contextAtNow(root)).toBe("");
  });

  test("looks at most eleven folders up for a project marker", () => {
    const levels = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`).join("/");
    const near = folder("near", ".git");
    folder("far", ".git");

    expect(contextAtNow(folder(`near/${levels(11)}`))).toBe(hint(near));
    expect(contextAtNow(folder(`far/${levels(12)}`))).toBe("");
  });
});
