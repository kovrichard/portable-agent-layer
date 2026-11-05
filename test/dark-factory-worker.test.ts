import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskDir } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import * as worker from "../assets/plugins/dark-factory/scripts/worker.mjs";
import { buildWorld, TASK } from "./lib/dark-factory-build-fixture";

describe("the build lock", () => {
  function lockedTask(pid: number) {
    const world = buildWorld(import.meta.file);
    const dir = taskDir(TASK, world.env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "build.lock"), String(pid));
    return dir;
  }

  test("a lock whose pid is alive is held by that pid", () => {
    const dir = lockedTask(4242);
    expect(worker.liveLockPid(dir, () => true)).toBe(4242);
  });

  test("a lock whose pid is gone is ignored and removed", () => {
    const dir = lockedTask(4242);
    expect(worker.liveLockPid(dir, () => false)).toBeNull();
    expect(existsSync(join(dir, "build.lock"))).toBe(false);
  });

  test("no lock means no holder", () => {
    const world = buildWorld(import.meta.file);
    expect(worker.liveLockPid(taskDir(TASK, world.env), () => true)).toBeNull();
  });
});

describe("where the worker runs", () => {
  test("a failing systemd probe picks a plain detached child", () => {
    expect(worker.chooseIsolation({ platform: "linux", probe: () => 1 })).toBe(
      "detached"
    );
  });

  test("a passing probe on Linux picks a systemd scope", () => {
    expect(worker.chooseIsolation({ platform: "linux", probe: () => 0 })).toBe(
      "systemd-scope"
    );
  });

  test("macOS and Windows never probe and run detached", () => {
    const probe = () => {
      throw new Error("probed");
    };
    expect(worker.chooseIsolation({ platform: "darwin", probe })).toBe("detached");
    expect(worker.chooseIsolation({ platform: "win32", probe })).toBe("detached");
  });
});
