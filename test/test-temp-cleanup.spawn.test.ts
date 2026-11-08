import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPO = resolve(import.meta.dir, "..");

const TMP_FN = ["tmp", "dir"].join("");
const MKTEMP_FN = ["mkd", "temp", "Sync"].join("");
const AFTER_ALL = ["after", "All"].join("");
const AFTER_EACH = ["after", "Each"].join("");

function fixtureSource(fails: boolean): string {
  return `import { expect, test } from "bun:test";
import { mkdirSync, ${MKTEMP_FN} as makeTemp, writeFileSync } from "node:fs";
import { ${TMP_FN} as systemTemp } from "node:os";
import { resolve } from "node:path";
import { outsideRepoHome, freshTestDir } from "${resolve(REPO, "test/lib/test-home").replaceAll("\\", "/")}";

test("writes into the system temp folder", () => {
  mkdirSync(outsideRepoHome(import.meta.file), { recursive: true });
  writeFileSync(resolve(outsideRepoHome(import.meta.file), "x.txt"), "x");
  const own = makeTemp(resolve(systemTemp(), "code-under-test-"));
  writeFileSync(resolve(own, "y.txt"), "y");
  writeFileSync(resolve(systemTemp(), "loose-file.txt"), "z");
  const childCode = "const fs = require('node:fs'); const os = require('node:os'); fs.${MKTEMP_FN}(os.${TMP_FN}() + '/child-')";
  const child = Bun.spawnSync(["bun", "-e", childCode]);
  expect(child.exitCode).toBe(0);
  freshTestDir(import.meta.file);
  expect(${fails ? "false" : "true"}).toBe(true);
});
`;
}

function runFixtureWithTmpdir(options: { fails: boolean; tmp: string; root: string }) {
  const folder = resolve(options.root, "fixture");
  mkdirSync(folder, { recursive: true });
  const name = options.fails ? "leaky-failing.spawn.test.ts" : "leaky.spawn.test.ts";
  writeFileSync(resolve(folder, name), fixtureSource(options.fails));
  mkdirSync(options.tmp, { recursive: true });
  const result = Bun.spawnSync(
    ["bun", "test", `./${relativeToRepo(resolve(folder, name))}`],
    {
      cwd: REPO,
      env: {
        ...process.env,
        TMPDIR: options.tmp,
        TEMP: options.tmp,
        TMP: options.tmp,
        PAL_TEST_ROOT: resolve(options.root, "pal-test-root"),
      },
      stdout: "ignore",
      stderr: "ignore",
    }
  );
  return result.exitCode;
}

function relativeToRepo(path: string): string {
  return path.slice(REPO.length + 1).replaceAll("\\", "/");
}

describe("a test run leaves nothing in the system temp folder", () => {
  test("a passing single-file run leaves its TMPDIR empty", () => {
    const dir = freshTestDir(import.meta.file);
    const tmp = resolve(dir, "tmp");
    expect(runFixtureWithTmpdir({ fails: false, tmp, root: dir })).toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
  });

  test("a failing single-file run leaves its TMPDIR empty", () => {
    const dir = freshTestDir(import.meta.file);
    const tmp = resolve(dir, "tmp");
    expect(runFixtureWithTmpdir({ fails: true, tmp, root: dir })).not.toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
  });

  test("a second run adds and changes nothing", () => {
    const dir = freshTestDir(import.meta.file);
    const tmp = resolve(dir, "tmp");
    runFixtureWithTmpdir({ fails: false, tmp, root: dir });
    const afterFirst = readdirSync(tmp);
    runFixtureWithTmpdir({ fails: false, tmp, root: dir });
    expect(readdirSync(tmp)).toEqual(afterFirst);
    expect(afterFirst).toEqual([]);
  });

  test("entries the run did not create are left alone", () => {
    const dir = freshTestDir(import.meta.file);
    const tmp = resolve(dir, "tmp");
    mkdirSync(resolve(tmp, "someone-elses-folder"), { recursive: true });
    writeFileSync(resolve(tmp, "someone-elses-folder", "keep.txt"), "keep");
    writeFileSync(resolve(tmp, "pal-test-lookalike-owned-by-another"), "keep");
    runFixtureWithTmpdir({ fails: false, tmp, root: dir });
    expect(readdirSync(tmp).sort()).toEqual([
      "pal-test-lookalike-owned-by-another",
      "someone-elses-folder",
    ]);
    expect(existsSync(resolve(tmp, "someone-elses-folder", "keep.txt"))).toBe(true);
  });
});

describe("the rule is written down and enforced", () => {
  const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), "utf-8");

  test("test/setup.ts registers the cleanup after all tests", () => {
    expect(read("test/setup.ts")).toContain(`${AFTER_ALL}(`);
  });

  test("klint allows teardown only in the framework and still forbids it in test files", () => {
    const yaml = read("test/klint.yaml");
    expect(yaml).toContain(`${AFTER_EACH}|${AFTER_ALL}`);
    expect(yaml).toContain("!server-cli.spawn.test.ts");
    expect(yaml).toContain("test/setup.ts");
    expect(yaml).toMatch(/set up for themselves/);
  });

  test("no test file other than server-cli gains a teardown hook", () => {
    const teardown = new RegExp(`\\b(${AFTER_EACH}|${AFTER_ALL})\\b`);
    const offenders = readdirSync(resolve(REPO, "test"))
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "server-cli.spawn.test.ts")
      .filter((file) => file !== "test-temp-cleanup.spawn.test.ts")
      .filter((file) => teardown.test(read("test", file)));
    expect(offenders).toEqual([]);
  });

  test("AGENTS.md states the rule under Running and testing", () => {
    const section = read("AGENTS.md")
      .split("## Running and testing")[1]
      .split("\n## ")[0];
    expect(section).toContain(AFTER_ALL);
    expect(section).toMatch(/set up only for themselves|only set up for themselves/i);
    expect(section).toMatch(/temp folder/i);
  });
});
