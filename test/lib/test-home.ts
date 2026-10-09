import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { removeOnceReleased } from "./remove-once-released";

export const TEST_ROOT = resolve(import.meta.dir, "../../.test");

function suiteName(file: string): string {
  return basename(file).replace(/\.test\.ts$/, "");
}

/** A fixed folder for this suite under .test/, so a rerun reuses it instead of piling up. */
export function testHome(file: string, label = "home"): string {
  return resolve(TEST_ROOT, suiteName(file), label);
}

/**
 * A fixed folder for this suite with no project above it, for code that walks up
 * to the nearest .git or package.json. Keyed by checkout so Stryker sandboxes never share one.
 */
export function outsideRepoHome(file: string): string {
  const checkout = Bun.hash(TEST_ROOT).toString(36);
  return resolve(tmpdir(), `pal-test-${checkout}`, suiteName(file));
}

/** What the previous run's freshTestDir() handed out, until this run's first call wipes it. */
export function leftoverTestDirs(file: string): string[] {
  const tmp = testHome(file, "tmp");
  if (!existsSync(tmp)) return [];
  return readdirSync(tmp).map((name) => resolve(tmp, name));
}

const handedOut = new Map<string, number>();

/** An empty folder per call, numbered under the suite's tmp/, which the first call wipes. */
export function freshTestDir(file: string): string {
  const tmp = testHome(file, "tmp");
  const count = handedOut.get(tmp) ?? 0;
  if (count === 0) removeOnceReleased(tmp);
  handedOut.set(tmp, count + 1);
  const dir = resolve(tmp, String(count + 1));
  mkdirSync(dir, { recursive: true });
  return dir;
}
