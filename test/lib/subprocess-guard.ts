import { beforeEach, mock } from "bun:test";
import childProcess from "node:child_process";
import { basename, relative } from "node:path";

const SPAWNING_EXPORTS = [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
] as const;

export function isSpawnTestFile(file: string): boolean {
  return /\.spawn\.test\.tsx?$/.test(file);
}

export function spawnRefusal(file: string, command: string): string {
  const name = basename(file).replace(/\.test\.(tsx?)$/, ".spawn.test.$1");
  return `${relative(process.cwd(), file)} started a subprocess (${command}), which only a *.spawn.test.ts file may: move this test into ${name}`;
}

function commandName(args: unknown[]): string {
  const first = args[0] as unknown[] | { cmd?: unknown[] } | string;
  if (typeof first === "string") return first;
  const argv = Array.isArray(first) ? first : first?.cmd;
  return String(argv?.[0] ?? "unknown");
}

let swallowedRefusal: string | null = null;

function refuseOutsideSpawnFiles<T extends (...args: never[]) => unknown>(real: T): T {
  return ((...args: Parameters<T>) => {
    const file = Bun.main;
    if (isSpawnTestFile(file)) return real(...args);
    swallowedRefusal ??= spawnRefusal(file, commandName(args));
    throw new Error(swallowedRefusal);
  }) as T;
}

function failTheTestAfterOneWhoseCodeCaughtTheRefusal() {
  beforeEach(() => {
    const refusal = swallowedRefusal;
    swallowedRefusal = null;
    if (refusal) throw new Error(`the previous test: ${refusal}`);
  });
}

function guardChildProcess() {
  const guarded: Record<string, unknown> = { ...childProcess };
  for (const name of SPAWNING_EXPORTS)
    guarded[name] = refuseOutsideSpawnFiles(childProcess[name]);
  guarded.default = guarded;
  mock.module("node:child_process", () => guarded);
  mock.module("child_process", () => guarded);
}

function guardBunSpawn() {
  Bun.spawn = refuseOutsideSpawnFiles(Bun.spawn.bind(Bun)) as typeof Bun.spawn;
  Bun.spawnSync = refuseOutsideSpawnFiles(
    Bun.spawnSync.bind(Bun)
  ) as typeof Bun.spawnSync;
}

export function refuseSubprocessesOutsideSpawnFiles() {
  guardChildProcess();
  guardBunSpawn();
  failTheTestAfterOneWhoseCodeCaughtTheRefusal();
}
