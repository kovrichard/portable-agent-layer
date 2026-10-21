import { Glob } from "bun";

/** Windows CI runners stall on process spawns at 4 workers, enough to push a test past the 5 s limit. */
function workersForThisPlatform(): number {
  return process.platform === "win32" ? 2 : 4;
}

const TIERS = { "--fast": false, "--spawn": true } as const;

function isSpawnFile(file: string): boolean {
  return file.endsWith(".spawn.test.ts");
}

function testFilesOf(spawn: boolean): string[] {
  return Array.from(new Glob("test/**/*.test.ts").scanSync())
    .filter((file) => isSpawnFile(file) === spawn)
    .map((file) => `./${file.replaceAll("\\", "/")}`)
    .sort();
}

function tierFiles(args: string[]): string[] {
  const tier = args.find((arg): arg is keyof typeof TIERS => arg in TIERS);
  return tier ? testFilesOf(TIERS[tier]) : [];
}

const args = process.argv.slice(2);

const result = Bun.spawnSync(
  [
    "bun",
    "test",
    "--randomize",
    "--isolate",
    `--parallel=${workersForThisPlatform()}`,
    ...args.filter((arg) => !(arg in TIERS)),
    ...tierFiles(args),
  ],
  { stdio: ["inherit", "inherit", "inherit"] }
);
process.exit(result.exitCode ?? 1);
