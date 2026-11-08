import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { removeOnceReleased } from "./remove-once-released";

export const TEST_ROOT =
  process.env.PAL_TEST_ROOT ?? resolve(import.meta.dir, "../../.test");

const checkout = Bun.hash(TEST_ROOT).toString(36);
const TEMP_PREFIX = `pal-test-${checkout}-`;
let ownTemp: string | undefined;

function suiteName(file: string): string {
  return basename(file).replace(/\.test\.ts$/, "");
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Points TMPDIR, TMP and TEMP at a folder this test process owns, and removes the
 * folders left by runs whose process is gone. Called from test/setup.ts once per test process.
 */
export function redirectTempIntoTestFolder(): void {
  const systemTmp = tmpdir();
  for (const name of readdirSync(systemTmp)) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const pid = Number(name.slice(TEMP_PREFIX.length));
    if (Number.isInteger(pid) && processIsGone(pid)) {
      removeOnceReleased(resolve(systemTmp, name));
    }
  }
  ownTemp = resolve(systemTmp, `${TEMP_PREFIX}${process.pid}`);
  mkdirSync(ownTemp, { recursive: true });
  process.env.TMPDIR = ownTemp;
  process.env.TMP = ownTemp;
  process.env.TEMP = ownTemp;
}

/** Removes the folder redirectTempIntoTestFolder() created. The preload in test/setup.ts calls it once per test process, after the last test. */
export function removeTestTempFolder(): void {
  if (ownTemp) removeOnceReleased(ownTemp);
}

/** A fixed folder for this suite under .test/, so a rerun reuses it instead of piling up. */
export function testHome(file: string, label = "home"): string {
  return resolve(TEST_ROOT, suiteName(file), label);
}

/**
 * A fixed folder for this suite with no project above it, for code that walks up
 * to the nearest .git or package.json. It lives in the run's temp folder, which the
 * framework removes when the test process ends, so nothing stays in the system temp folder.
 */
export function outsideRepoHome(file: string): string {
  return resolve(tmpdir(), suiteName(file));
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
