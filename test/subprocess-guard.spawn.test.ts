import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPO = resolve(import.meta.dir, "..");

let dir: string;

beforeEach(() => {
  dir = freshTestDir(import.meta.file);
});

function writeTestFile(name: string, body: string): string {
  const file = resolve(dir, name);
  writeFileSync(file, `import { expect, test } from "bun:test";\n${body}\n`);
  return file;
}

function runTests(...files: string[]) {
  const result = Bun.spawnSync(
    ["bun", "test", ...files.map((file) => `./${relative(REPO, file)}`)],
    { cwd: REPO, stdout: "pipe", stderr: "pipe" }
  );
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

const SPAWNS_BUN = 'test("spawns", () => { Bun.spawnSync(["bun", "--version"]); });';
const SPAWNS_NODE_STYLE = [
  'import { spawnSync } from "node:child_process";',
  'test("spawns", () => { spawnSync("bun", ["--version"]); });',
].join("\n");
const CATCHES_THE_REFUSAL = [
  'test("catches", () => { try { Bun.spawnSync(["bun", "--version"]); } catch {} });',
  'test("catches after an await", async () => { await Promise.resolve(); try { Bun.spawnSync(["bun", "--version"]); } catch {} });',
  'test("next", () => { expect(1).toBe(1); });',
].join("\n");
const SPAWNS_THEN_PASSES = `${SPAWNS_BUN}\ntest("next", () => { expect(1).toBe(1); });`;

describe("a test file that is not *.spawn.test.ts cannot start a subprocess", () => {
  test("Bun.spawnSync fails the test and names the file to move it into", () => {
    const { exitCode, output } = runTests(writeTestFile("bun-spawn.test.ts", SPAWNS_BUN));
    expect(exitCode).not.toBe(0);
    expect(output).toContain("started a subprocess (bun)");
    expect(output).toContain("move this test into bun-spawn.spawn.test.ts");
  });

  test("node:child_process fails the test the same way", () => {
    const { exitCode, output } = runTests(
      writeTestFile("node-spawn.test.ts", SPAWNS_NODE_STYLE)
    );
    expect(exitCode).not.toBe(0);
    expect(output).toContain("started a subprocess (bun)");
  });

  test("code that catches the refusal still fails the test that spawned", () => {
    const { exitCode, output } = runTests(
      writeTestFile("catches.test.ts", CATCHES_THE_REFUSAL)
    );
    expect(exitCode).not.toBe(0);
    expect(output).toContain("(fail) catches");
    expect(output).toContain("(fail) catches after an await");
    expect(output).toContain(" 1 pass");
    expect(output).toContain(" 2 fail");
  });

  test("only the test that spawned fails, not the one after it", () => {
    const { output } = runTests(writeTestFile("then-passes.test.ts", SPAWNS_THEN_PASSES));
    expect(output).toContain("(fail) spawns");
    expect(output).toContain(" 1 pass");
    expect(output).toContain(" 1 fail");
  });
});

describe("a *.spawn.test.ts file can", () => {
  test("start subprocesses through Bun and node:child_process", () => {
    const { exitCode, output } = runTests(
      writeTestFile("bun-spawn.spawn.test.ts", SPAWNS_BUN),
      writeTestFile("node-spawn.spawn.test.ts", SPAWNS_NODE_STYLE)
    );
    expect(output).toContain("2 pass");
    expect(exitCode).toBe(0);
  });
});
