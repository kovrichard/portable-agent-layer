import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentDirOverrides } from "../src/core/paths";
import { reload } from "../src/core/settings";
import { collectDue, collectInChildProcess } from "../src/hooks/lib/collect-trigger";
import { freshTestDir } from "./lib/test-home";

let home: string;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;

  for (const { env } of agentDirOverrides()) process.env[env] = resolve(home, env);
  process.env.XDG_DATA_HOME = resolve(home, "data");
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

describe("collecting in a process of its own", () => {
  test("says no collect ran when another one holds the lock", () => {
    writeFileSync(resolve(home, "memory", "state", "collect.lock"), "123");
    expect(collectInChildProcess()).toBe(false);
  }, 30_000);

  test("collects, and the quarter hour starts again", () => {
    expect(collectInChildProcess()).toBe(true);
    expect(collectDue(Date.now())).toBe(false);
  }, 30_000);
});
