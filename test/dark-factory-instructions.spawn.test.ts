import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { readEvents, readTask } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import * as roleModule from "../assets/plugins/dark-factory/scripts/role.mjs";
import * as taskModule from "../assets/plugins/dark-factory/scripts/task.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

type Env = Record<string, string | undefined>;
type Outcome = { exitCode: number; error: string | null };
const runRoleHeadless = (
  roleModule as unknown as {
    runRoleHeadless: (taskId: string, role: string, options?: object) => Outcome;
  }
).runRoleHeadless;
const prepare = (taskModule as unknown as { prepare: (id: string, env: Env) => unknown })
  .prepare;

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const SUCCESS = resolve(import.meta.dir, "fixtures/claude-print-success.json");
const FLAG = "--append-system-prompt-file";
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

let home: string;
let userHome: string;
let clone: string;
let bin: string;
let record: string;

function env(): Env {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  );
  return {
    ...base,
    ...GIT_ENV,
    HOME: userHome,
    USERPROFILE: userHome,
    DARK_FACTORY_HOME: home,
    PATH: [bin, process.env.PATH ?? ""].join(delimiter),
  };
}

function timed<T>(label: string, work: () => T): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    const ms = performance.now() - start;
    if (ms > Number(process.env.DIAG_MS ?? 750))
      console.error(`DIAG slow ${Math.round(ms)}ms ${label}`);
  }
}

function git(cwd: string, ...args: string[]) {
  const result = timed(`git ${args.join(" ")}`, () =>
    spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...GIT_ENV },
    })
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function put(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function commitAll(cwd: string) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "x");
  git(cwd, "push", "-q", "origin", "canary");
}

function fakeClaude() {
  const logic = [
    `const fs = require("node:fs");`,
    `const argv = process.argv.slice(2);`,
    `const at = argv.indexOf(${JSON.stringify(FLAG)});`,
    `const appended = at === -1 ? null : fs.readFileSync(argv[at + 1], "utf8");`,
    `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv, appended }));`,
    `process.stdout.write(fs.readFileSync(${JSON.stringify(SUCCESS)}, "utf8"));`,
    "",
  ].join("\n");
  writeFakeBin(bin, "claude", logic);
}

const recorded = (): { argv: string[]; appended: string | null } =>
  JSON.parse(readFileSync(record, "utf8"));

type Setup = {
  user?: string;
  repo?: string;
  repoConfig?: object;
  factoryConfig?: object;
};

function setup({ user, repo, repoConfig = {}, factoryConfig }: Setup = {}) {
  if (user !== undefined) put(join(userHome, ".claude", "CLAUDE.md"), user);
  if (factoryConfig) put(join(home, "config.json"), JSON.stringify(factoryConfig));
  put(
    join(clone, ".dark-factory.json"),
    JSON.stringify({ gate: [], baseBranch: "canary", ...repoConfig })
  );
  if (repo !== undefined) put(join(clone, "CLAUDE.md"), repo);
  commitAll(clone);
  const e = env();
  put(
    join(home, "tasks", "t1", "task.json"),
    JSON.stringify({
      id: "t1",
      title: "Fix login",
      repo: clone,
      category: "small",
      status: "draft",
    })
  );
  put(join(home, "tasks", "t1", "spec.md"), "## Goal\n\nx\n");
  for (const tool of ["git", "gh", "bash"])
    timed(`${tool} --version`, () => spawnSync(tool, ["--version"], { env: e }));
  timed("git fetch", () =>
    spawnSync("git", ["fetch", "origin", "canary"], { cwd: clone, env: e })
  );
  timed("prepare", () => prepare("t1", e));
  timed("fakeClaude", () => fakeClaude());
}

function run(role = "reviewer") {
  return timed(`runRoleHeadless ${role}`, () =>
    runRoleHeadless("t1", role, { env: env() })
  );
}

function appended(): string {
  const text = recorded().appended;
  if (text === null) throw new Error(`claude was not given ${FLAG}`);
  return text;
}

let testStart = 0;

beforeEach(() => {
  const ms = performance.now() - testStart;
  if (testStart > 0 && ms > 3000)
    console.error(`DIAG previous test total ${Math.round(ms)}ms`);
  testStart = performance.now();
  home = freshTestDir(import.meta.file);
  userHome = join(home, "user");
  clone = join(home, "clone");
  bin = join(home, "bin");
  record = join(home, "claude-call.json");
  mkdirSync(userHome, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const remote = join(home, "remote.git");
  const seed = join(home, "seed");
  mkdirSync(seed, { recursive: true });
  git(home, "init", "-q", "--bare", "-b", "canary", remote);
  git(seed, "init", "-q", "-b", "canary");
  put(join(seed, "f.txt"), "one\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "canary");
  git(home, "clone", "-q", remote, clone);
  git(clone, "checkout", "-q", "canary");
});

describe("instructions reach the roles", () => {
  test("the user's and the repo's CLAUDE.md are passed in that order, each headed by its path", () => {
    setup({ user: "USER RULE\n", repo: "REPO RULE\n" });
    run();
    const text = appended() as string;
    expect(text).toContain("USER RULE");
    expect(text).toContain("REPO RULE");
    expect(text.indexOf("USER RULE")).toBeLessThan(text.indexOf("REPO RULE"));
    const userPath = join(userHome, ".claude", "CLAUDE.md");
    expect(text.slice(0, text.indexOf("USER RULE"))).toContain(userPath);
    const between = text.slice(text.indexOf("USER RULE"), text.indexOf("REPO RULE"));
    expect(between).toContain("CLAUDE.md");
  });

  test("the instructions file is written in the task folder", () => {
    setup({ user: "U\n", repo: "R\n" });
    run();
    const { argv } = recorded();
    const file = argv[argv.indexOf(FLAG) + 1] as string;
    expect(file.startsWith(join(home, "tasks", "t1"))).toBe(true);
  });

  test("a part whose file does not exist is skipped", () => {
    setup({ repo: "ONLY REPO\n" });
    run();
    const text = appended() as string;
    expect(text).toContain("ONLY REPO");
    expect(text).not.toContain(join(userHome, ".claude", "CLAUDE.md"));
  });

  test("with neither file the flag is not passed and the run is as before", () => {
    setup();
    const outcome = run();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.error).toBeNull();
    expect(recorded().argv).not.toContain(FLAG);
  });

  test("the setting sources stay empty when instructions are passed", () => {
    setup({ user: "U\n", repo: "R\n" });
    run();
    const { argv } = recorded();
    expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("");
  });
});

describe("@path imports", () => {
  test("an @path that starts a line is replaced by that file's content, relative to the importing file", () => {
    setup({
      repo: "before\n@docs/a.md\nafter\n",
    });
    put(join(clone, "docs", "a.md"), "A BODY\n@b.md\n");
    put(join(clone, "docs", "b.md"), "B BODY\n");
    // the checkout files are read at prepare, so prepare again with them in place
    prepare("t1", env());
    run();
    const text = appended() as string;
    expect(text).toContain("A BODY");
    expect(text).toContain("B BODY");
    expect(text).not.toContain("@docs/a.md");
    expect(text.indexOf("before")).toBeLessThan(text.indexOf("A BODY"));
    expect(text.indexOf("A BODY")).toBeLessThan(text.indexOf("after"));
  });

  test("~/ expands to the home folder", () => {
    put(join(userHome, "notes", "mine.md"), "MY NOTES\n");
    setup({ user: "@~/notes/mine.md\n" });
    run();
    const text = appended() as string;
    expect(text).toContain("MY NOTES");
    expect(text).not.toContain("@~/notes/mine.md");
  });

  test("imports stop after 5 levels", () => {
    setup({ repo: "@l1.md\n" });
    for (let level = 1; level <= 7; level += 1) {
      put(join(clone, `l${level}.md`), `LEVEL${level}\n@l${level + 1}.md\n`);
    }
    prepare("t1", env());
    run();
    const text = appended() as string;
    expect(text).toContain("LEVEL5");
    expect(text).not.toContain("LEVEL6");
    expect(text).not.toContain("LEVEL7");
  });

  test("an @ inside inline code, a code block or mid-line is left alone", () => {
    setup({
      repo: ["use `@a.md` inline", "```", "@a.md", "```", "mail me @a.md today", ""].join(
        "\n"
      ),
    });
    put(join(clone, "a.md"), "SHOULD NOT APPEAR\n");
    prepare("t1", env());
    run();
    const text = appended() as string;
    expect(text).not.toContain("SHOULD NOT APPEAR");
    expect(text).toContain("use `@a.md` inline");
    expect(text).toContain("mail me @a.md today");
    expect(text).toContain("```\n@a.md\n```");
  });

  test("an import that cannot be read is left as written and recorded", () => {
    setup({ repo: "keep\n@missing/nope.md\n" });
    run();
    expect(appended()).toContain("@missing/nope.md");
    const events = readEvents(env()).filter(
      (event: { event: string }) => event.event === "instructions_import_missing"
    );
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events[0])).toContain("nope.md");
  });
});

describe("the repo part is frozen at prepare", () => {
  test("a role that edits the worktree's CLAUDE.md does not change what the next role is told", () => {
    setup({ repo: "ORIGINAL RULE\n" });
    const task = readTask("t1", env()) as { worktree: string };
    put(join(task.worktree, "CLAUDE.md"), "EDITED BY A ROLE\n");
    run("code-writer");
    const text = appended() as string;
    expect(text).toContain("ORIGINAL RULE");
    expect(text).not.toContain("EDITED BY A ROLE");
  });
});

describe("the plugin works on its own", () => {
  test('"repoInstructions": false in .dark-factory.json skips the repo part', () => {
    setup({
      user: "USER RULE\n",
      repo: "REPO RULE\n",
      repoConfig: { repoInstructions: false },
    });
    run();
    const text = appended() as string;
    expect(text).toContain("USER RULE");
    expect(text).not.toContain("REPO RULE");
  });

  test('"userInstructions": false in ~/.dark-factory/config.json skips the user part', () => {
    setup({
      user: "USER RULE\n",
      repo: "REPO RULE\n",
      factoryConfig: { userInstructions: false },
    });
    run();
    const text = appended() as string;
    expect(text).toContain("REPO RULE");
    expect(text).not.toContain("USER RULE");
  });

  test("with both switched off the flag is not passed", () => {
    setup({
      user: "USER RULE\n",
      repo: "REPO RULE\n",
      repoConfig: { repoInstructions: false },
      factoryConfig: { userInstructions: false },
    });
    run();
    expect(recorded().argv).not.toContain(FLAG);
  });

  test("a missing config.json means both parts are on", () => {
    setup({ user: "USER RULE\n", repo: "REPO RULE\n" });
    run();
    const text = appended() as string;
    expect(text).toContain("USER RULE");
    expect(text).toContain("REPO RULE");
  });

  test("nothing in the plugin folder refers to PAL", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else {
          const body = readFileSync(path, "utf8");
          if (body.includes(".pal/") || body.includes("pal cli")) hits.push(path);
        }
      }
    };
    walk(PLUGIN_ROOT);
    expect(hits).toEqual([]);
  });

  test("the README says what roles receive, how to switch each part off, and that hooks never run", () => {
    const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");
    expect(readme).toContain("CLAUDE.md");
    expect(readme).toContain("repoInstructions");
    expect(readme).toContain("userInstructions");
    expect(readme).toContain("~/.dark-factory/config.json");
    expect(readme.toLowerCase()).toMatch(/hooks? (never|do not|don't) run/);
  });
});
