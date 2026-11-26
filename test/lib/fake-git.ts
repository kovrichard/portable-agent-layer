import { mock } from "bun:test";
import * as childProcess from "node:child_process";

const guardedSpawnSync = childProcess.spawnSync as (...args: unknown[]) => unknown;

function notACheckout() {
  return { status: 128, stdout: "", stderr: "fatal: not a git repository" };
}

export function answerGitAsNotACheckout(testFile: string): void {
  mock.module("node:child_process", () => ({
    ...childProcess,
    spawnSync: (...args: unknown[]) =>
      Bun.main === testFile && args[0] === "git"
        ? notACheckout()
        : guardedSpawnSync(...args),
  }));
}
