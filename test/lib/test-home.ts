import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { removeOnceReleased } from "./remove-once-released";

const TEST_ROOT = resolve(import.meta.dir, "../../.test");

function suiteName(file: string): string {
  return basename(file).replace(/\.test\.ts$/, "");
}

/** A fixed folder for this suite under .test/, so a rerun reuses it instead of piling up. */
export function testHome(file: string, label = "home"): string {
  return resolve(TEST_ROOT, suiteName(file), label);
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
