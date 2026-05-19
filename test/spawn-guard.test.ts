import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  buildSpawnGuardEnv,
  getInferenceDepth,
  isPalSpawnedInference,
  SPAWN_GUARD_ENV,
} from "../src/hooks/lib/spawn-guard";

const KEYS = [SPAWN_GUARD_ENV.SENTINEL, SPAWN_GUARD_ENV.DEPTH] as const;

describe("spawn-guard helpers", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("isPalSpawnedInference false when sentinel absent", () => {
    expect(isPalSpawnedInference()).toBe(false);
  });

  test("isPalSpawnedInference true when sentinel = '1'", () => {
    process.env[SPAWN_GUARD_ENV.SENTINEL] = "1";
    expect(isPalSpawnedInference()).toBe(true);
  });

  test("isPalSpawnedInference false for any other value", () => {
    process.env[SPAWN_GUARD_ENV.SENTINEL] = "true";
    expect(isPalSpawnedInference()).toBe(false);
    process.env[SPAWN_GUARD_ENV.SENTINEL] = "0";
    expect(isPalSpawnedInference()).toBe(false);
  });

  test("getInferenceDepth defaults to 0", () => {
    expect(getInferenceDepth()).toBe(0);
  });

  test("getInferenceDepth parses integer string", () => {
    process.env[SPAWN_GUARD_ENV.DEPTH] = "3";
    expect(getInferenceDepth()).toBe(3);
  });

  test("getInferenceDepth returns 0 for garbage values", () => {
    process.env[SPAWN_GUARD_ENV.DEPTH] = "not-a-number";
    expect(getInferenceDepth()).toBe(0);
    process.env[SPAWN_GUARD_ENV.DEPTH] = "-5";
    expect(getInferenceDepth()).toBe(0);
  });

  test("buildSpawnGuardEnv sets sentinel and increments depth", () => {
    const parent = { FOO: "bar" } as NodeJS.ProcessEnv;
    const child = buildSpawnGuardEnv(parent);
    expect(child[SPAWN_GUARD_ENV.SENTINEL]).toBe("1");
    expect(child[SPAWN_GUARD_ENV.DEPTH]).toBe("1");
    expect(child.FOO).toBe("bar");
  });

  test("buildSpawnGuardEnv increments existing depth", () => {
    const parent = { [SPAWN_GUARD_ENV.DEPTH]: "2" } as NodeJS.ProcessEnv;
    const child = buildSpawnGuardEnv(parent);
    expect(child[SPAWN_GUARD_ENV.DEPTH]).toBe("3");
  });

  test("buildSpawnGuardEnv does not mutate parent env", () => {
    const parent = { FOO: "bar" } as NodeJS.ProcessEnv;
    buildSpawnGuardEnv(parent);
    expect(parent[SPAWN_GUARD_ENV.SENTINEL]).toBeUndefined();
    expect(parent[SPAWN_GUARD_ENV.DEPTH]).toBeUndefined();
  });

  test("MAX_DEPTH constant is exported for dispatcher use", () => {
    expect(SPAWN_GUARD_ENV.MAX_DEPTH).toBe(1);
  });

  test("buildSpawnGuardEnv sets CLAUDECODE to undefined for the child", () => {
    const parent = { CLAUDECODE: "1", FOO: "bar" } as NodeJS.ProcessEnv;
    const child = buildSpawnGuardEnv(parent);
    expect(child.CLAUDECODE).toBeUndefined();
    expect(child.FOO).toBe("bar");
    // Parent untouched — scoping is to the returned object only.
    expect(parent.CLAUDECODE).toBe("1");
  });
});

describe("spawn-guard integration — hook entry-points short-circuit when spawned", () => {
  const REPO_ROOT = resolve(import.meta.dir, "..");
  const HOOKS_TO_GUARD = [
    "src/hooks/LoadContext.ts",
    "src/hooks/StopOrchestrator.ts",
    "src/hooks/UserPromptOrchestrator.ts",
    "src/hooks/CompactRecover.ts",
    "src/hooks/PreCompactPersist.ts",
  ] as const;

  for (const hookPath of HOOKS_TO_GUARD) {
    test(`${hookPath} exits silently when PAL_SPAWNED_INFERENCE=1`, () => {
      const result = spawnSync("bun", ["run", resolve(REPO_ROOT, hookPath)], {
        env: {
          ...process.env,
          [SPAWN_GUARD_ENV.SENTINEL]: "1",
          PAL_AGENT: "claude",
        },
        input: "{}",
        encoding: "utf-8",
        timeout: 5000,
      });
      // Spawned hooks must exit 0 with no stdout — no context injection,
      // no stop work, no rating capture. Stderr is allowed (debug logging).
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });
  }
});
