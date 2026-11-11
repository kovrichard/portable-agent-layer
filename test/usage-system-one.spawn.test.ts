import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

test("pal cli usage reads judge_call events from the event log", () => {
  const home = freshTestDir(import.meta.file);
  const ts = new Date().toISOString();
  const dir = resolve(home, "memory", "events");
  mkdirSync(dir, { recursive: true });
  const line = {
    v: 1,
    id: "j1",
    ts,
    type: "judge_call",
    session: null,
    runtime: "claude",
    machine: "m",
    actor: "a",
    authority: "self",
    channel: null,
    project: null,
    cwd: "/w",
    caller: "c",
    mode: "shadow",
    route: "fallback",
    model: "jev-1.14.0",
    inputTokens: 1000,
    costUsd: 0.000042,
    failure: null,
  };
  writeFileSync(resolve(dir, `${ts.slice(0, 7)}.jsonl`), `${JSON.stringify(line)}\n`);
  const out = spawnSync("bun", ["run", CLI, "cli", "usage"], {
    env: { ...process.env, PAL_HOME: home, PAL_SKIP_DOCTOR: "1" },
    encoding: "utf-8",
    timeout: 60_000,
  });
  expect(out.stdout).toContain("PAL Inference (jev-1.14.0)");
  const block = out.stdout.slice(out.stdout.indexOf("PAL Inference (jev-1.14.0)"));
  const total = block.split("\n").find((l) => l.includes("Total"));
  expect(total).toMatch(/\b1\b/);
});
