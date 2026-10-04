import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-history-slug-"));
  process.env.PAL_HOME = HOME;
});

afterEach(() => {
  delete process.env.PAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

/** A registered project whose checkout directory need not share its name. */
function registerProject(name: string, dirName: string): string {
  const checkout = resolve(HOME, "checkouts", dirName);
  mkdirSync(checkout, { recursive: true });
  const record = resolve(HOME, "memory", "projects", name);
  mkdirSync(record, { recursive: true });
  writeFileSync(
    resolve(record, "ISA.md"),
    `---\nname: "${name}"\nstatus: "active"\n` +
      `created: "2026-01-01"\nupdated: "2026-02-02"\n---\n\n## Goal\nShip.\n`
  );
  const bindings = resolve(HOME, "bindings.json");
  const current = existsSync(bindings)
    ? (JSON.parse(readFileSync(bindings, "utf-8")) as Record<string, string>)
    : {};
  current[name] = checkout;
  writeFileSync(bindings, JSON.stringify(current, null, 2));
  return checkout;
}

function entry(title: string) {
  return { date: "2026-03-03", title, summary: "s", insights: "i" };
}

function projectHistory(name: string): string {
  return resolve(HOME, "memory", "projects", name, "history.jsonl");
}

function parkedHistory(slug: string): string {
  return resolve(HOME, "memory", "state", "unbound-history", `${slug}.jsonl`);
}

function folderInRegistry(slug: string): string {
  return resolve(HOME, "memory", "projects", slug);
}

describe("history routing", () => {
  test("a project checked out under a different directory name owns its history", async () => {
    const checkout = registerProject("alpha", "workspace");
    const { appendProjectHistory } = await import("../src/hooks/lib/work-tracking");

    appendProjectHistory(checkout, entry("did the thing"));

    expect(existsSync(projectHistory("alpha"))).toBe(true);
    expect(existsSync(folderInRegistry("workspace"))).toBe(false);
  });

  test("a subdirectory of a project resolves to the project, not the subdirectory", async () => {
    const checkout = registerProject("beta", "beta");
    const nested = resolve(checkout, "src", "server");
    mkdirSync(nested, { recursive: true });
    const { appendProjectHistory } = await import("../src/hooks/lib/work-tracking");

    appendProjectHistory(nested, entry("worked deeper in the tree"));

    expect(existsSync(projectHistory("beta"))).toBe(true);
    expect(existsSync(folderInRegistry("server"))).toBe(false);
  });

  test("an unregistered directory parks its history and mints no project folder", async () => {
    const loose = resolve(HOME, "checkouts", "untracked");
    mkdirSync(loose, { recursive: true });
    const { appendProjectHistory } = await import("../src/hooks/lib/work-tracking");

    appendProjectHistory(loose, entry("ad-hoc session"));

    expect(existsSync(parkedHistory("untracked"))).toBe(true);
    expect(existsSync(folderInRegistry("untracked"))).toBe(false);
  });

  test("what was written is what is read back", async () => {
    const checkout = registerProject("alpha", "workspace");
    const { appendProjectHistory, readProjectHistory } = await import(
      "../src/hooks/lib/work-tracking"
    );

    appendProjectHistory(checkout, entry("did the thing"));

    expect(readProjectHistory(checkout).map((h) => h.title)).toEqual(["did the thing"]);
  });

  test("a project's last session is found by name, from any folder", async () => {
    const checkout = registerProject("alpha", "workspace");
    const { appendProjectHistory, lastSessionTitle } = await import(
      "../src/hooks/lib/work-tracking"
    );

    appendProjectHistory(checkout, entry("first"));
    appendProjectHistory(checkout, entry("latest"));

    expect(lastSessionTitle("alpha")).toBe("latest");
    expect(lastSessionTitle("never-worked-on")).toBeUndefined();
  });

  test("a session keeps one entry, its latest summary", async () => {
    const checkout = registerProject("alpha", "workspace");
    const { appendProjectHistory, readProjectHistory } = await import(
      "../src/hooks/lib/work-tracking"
    );

    appendProjectHistory(checkout, { ...entry("early summary"), session: "s1" });
    appendProjectHistory(checkout, { ...entry("another session"), session: "s2" });
    appendProjectHistory(checkout, { ...entry("later summary"), session: "s1" });
    appendProjectHistory(checkout, entry("no session id"));
    appendProjectHistory(checkout, entry("no session id"));

    expect(readProjectHistory(checkout).map((h) => h.title)).toEqual([
      "another session",
      "later summary",
      "no session id",
      "no session id",
    ]);
  });
});

describe("parked history finds its project", () => {
  async function parkUnder(dirName: string, title: string): Promise<string> {
    const loose = resolve(HOME, "checkouts", dirName);
    mkdirSync(loose, { recursive: true });
    const { appendProjectHistory } = await import("../src/hooks/lib/work-tracking");
    appendProjectHistory(loose, entry(title));
    return loose;
  }

  test("moves in the moment its project is created here, with no migration run", async () => {
    const loose = await parkUnder("delta", "before the project existed");
    const { writeProject } = await import("../src/hooks/lib/projects");

    writeProject({
      name: "delta",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
      path: loose,
    });

    expect(readFileSync(projectHistory("delta"), "utf-8")).toContain(
      "before the project existed"
    );
    expect(existsSync(parkedHistory("delta"))).toBe(false);
    const { checkPendingMigrations } = await import("../src/cli/migrate");
    expect(checkPendingMigrations()).toEqual([]);
  });

  test("never mints a project folder for a binding with no project record", async () => {
    const loose = await parkUnder("ghost", "no record anywhere");
    const { writeBinding } = await import("../src/hooks/lib/bindings");

    writeBinding("ghost", loose);

    expect(existsSync(folderInRegistry("ghost"))).toBe(false);
    expect(existsSync(parkedHistory("ghost"))).toBe(true);
  });

  test("stays parked while two projects are checked out under that name", async () => {
    const loose = await parkUnder("shared", "whose is it");
    const other = resolve(HOME, "elsewhere", "shared");
    mkdirSync(other, { recursive: true });
    registerProject("first", "shared");
    registerProject("second", "shared");
    const { writeBindings } = await import("../src/hooks/lib/bindings");

    writeBindings({ first: loose, second: other });

    expect(existsSync(parkedHistory("shared"))).toBe(true);
  });
});

describe("v6 history-slugs", () => {
  /** History as the old writer left it: a folder named after the cwd. */
  function orphanFolder(slug: string, title: string): void {
    const dir = folderInRegistry(slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "history.jsonl"), `${JSON.stringify(entry(title))}\n`);
  }

  async function run() {
    const { runMigrate } = await import("../src/cli/migrate");
    runMigrate([]);
  }

  test("reattaches an orphan to the project checked out in that directory", async () => {
    registerProject("alpha", "workspace");
    orphanFolder("workspace", "stranded entry");

    await run();

    expect(readFileSync(projectHistory("alpha"), "utf-8")).toContain("stranded entry");
    expect(existsSync(folderInRegistry("workspace"))).toBe(false);
  });

  test("parks an orphan no project claims, keeping every entry", async () => {
    orphanFolder("unclaimed", "recorded somewhere else");

    await run();

    expect(readFileSync(parkedHistory("unclaimed"), "utf-8")).toContain(
      "recorded somewhere else"
    );
    expect(existsSync(folderInRegistry("unclaimed"))).toBe(false);
  });

  test("keeps both sides when the destination already has history", async () => {
    registerProject("alpha", "workspace");
    writeFileSync(
      projectHistory("alpha"),
      `${JSON.stringify(entry("already recorded"))}\n`
    );
    orphanFolder("workspace", "stranded entry");

    await run();

    const merged = readFileSync(projectHistory("alpha"), "utf-8");
    expect(merged).toContain("already recorded");
    expect(merged).toContain("stranded entry");
  });

  test("folds parked history back in once its project is registered", async () => {
    const loose = resolve(HOME, "checkouts", "gamma");
    mkdirSync(loose, { recursive: true });
    const { appendProjectHistory } = await import("../src/hooks/lib/work-tracking");
    appendProjectHistory(loose, entry("before registration"));

    registerProject("gamma", "gamma");
    await run();

    expect(readFileSync(projectHistory("gamma"), "utf-8")).toContain(
      "before registration"
    );
    expect(existsSync(parkedHistory("gamma"))).toBe(false);
  });

  test("does not claim it kept the files it moved", async () => {
    orphanFolder("unclaimed", "recorded somewhere else");
    const printed: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => printed.push(args.join(" "));
    try {
      await run();
    } finally {
      console.log = log;
    }

    expect(printed.join("\n")).not.toContain("preserved");
  });

  test("leaves a registered project's own history alone", async () => {
    registerProject("beta", "beta");
    writeFileSync(projectHistory("beta"), `${JSON.stringify(entry("mine"))}\n`);

    const { checkPendingMigrations } = await import("../src/cli/migrate");
    expect(checkPendingMigrations().find((m) => m.id === "v6-history-slugs")).toBe(
      undefined
    );
  });
});
