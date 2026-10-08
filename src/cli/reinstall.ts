import { spawnSync } from "node:child_process";

/**
 * An update replaces PAL's files under a process that already holds the old
 * modules in Bun's cache, so a new installer importing a new export would bind
 * against the stale module and throw. A fresh process loads everything from disk.
 */
export function reinstallInFreshProcess(
  entry: string = process.argv[1],
  env: Record<string, string> = {}
): number {
  const run = spawnSync(process.execPath, [entry, "cli", "install"], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return run.status ?? 1;
}
