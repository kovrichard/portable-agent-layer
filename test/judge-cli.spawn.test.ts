import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const SRC = resolve(import.meta.dir, "../src/cli/judge.ts");

const REQUEST = {
  caller: "cli-smoke",
  state: "hello",
  questions: { q: { type: "noul", instructions: "Is it a greeting?" } },
};

function run(home: string, args: string[], input?: string) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAL_HOME: home,
    PAL_SKIP_DOCTOR: "1",
    PAL_INFERENCE_DISABLED: "1",
  };
  delete env.PAL_TYPESAFE_API_KEY;
  delete env.TYPESAFE_API_KEY;
  return spawnSync("bun", ["run", CLI, "cli", "judge", ...args], {
    env,
    input,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("pal cli judge reads a request from a file and prints the result as JSON", () => {
  const home = freshTestDir(import.meta.file);
  const file = resolve(home, "request.json");
  writeFileSync(file, JSON.stringify(REQUEST));
  const out = run(home, [file]);
  const printed = JSON.parse(out.stdout.trim());
  expect(printed.route).toBe("fallback");
});

test("pal cli judge reads a request from stdin", () => {
  const home = freshTestDir(import.meta.file);
  const out = run(home, [], JSON.stringify(REQUEST));
  expect(JSON.parse(out.stdout.trim()).route).toBe("fallback");
});

test("the command is a thin wrapper: it imports judge and holds no HTTP or inference call", () => {
  const source = readFileSync(SRC, "utf-8");
  expect(source).toMatch(/from "\.\.\/hooks\/lib\/judge"/);
  expect(source).not.toMatch(/\bfetch\(/);
  expect(source).not.toMatch(/hooks\/lib\/inference"/);
  expect(source).not.toMatch(/logQuietly|appendEvent/);
});
