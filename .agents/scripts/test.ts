import { existsSync, readFileSync } from "node:fs";
import { Glob } from "bun";

/** Windows CI runners stall on process spawns at 4 workers, enough to push a test past the 5 s limit. */
function workersForThisPlatform(): number {
  return process.platform === "win32" ? 2 : 4;
}

const TIERS = { "--fast": false, "--spawn": true } as const;

function isSpawnFile(file: string): boolean {
  return file.endsWith(".spawn.test.ts");
}

export function testFilesOf(spawn: boolean, root = "."): string[] {
  return Array.from(new Glob("test/**/*.test.ts").scanSync(root))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => isSpawnFile(file) === spawn)
    .sort();
}

function tierFiles(args: string[]): string[] {
  const tier = args.find((arg): arg is keyof typeof TIERS => arg in TIERS);
  return tier ? testFilesOf(TIERS[tier]).map((file) => `./${file}`) : [];
}

const TIMING_REPORT = ".test/test-report.xml";
const SLOWEST_PER_TIER = 10;

/** Bun's own per-test times, so no hook has to merge timings across isolated processes. */
function timingReportArgs(): string[] {
  return ["--reporter=junit", `--reporter-outfile=${TIMING_REPORT}`];
}

function xmlUnescaped(text: string): string {
  const entities: Record<string, string> = {
    "&apos;": "'",
    "&quot;": '"',
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
  };
  return text.replace(/&(apos|quot|lt|gt|amp);/g, (entity) => entities[entity]);
}

function attributesOf(tag: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(tag.matchAll(/(\w+)="([^"]*)"/g), ([, key, value]) => [
      key,
      xmlUnescaped(value),
    ])
  );
}

export function slowestTests(junit: string, count: number, spawn: boolean): string[] {
  return Array.from(junit.matchAll(/<testcase\s[^>]*>/g), ([tag]) => attributesOf(tag))
    .map((test) => {
      const file = (test.file ?? "").replaceAll("\\", "/");

      return {
        file,
        seconds: Number(test.time),
        where: `${file} > ${test.classname} > ${test.name}`,
      };
    })
    .filter((test) => isSpawnFile(test.file) === spawn)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count)
    .map((test) => `${test.seconds.toFixed(2).padStart(7)}s  ${test.where}`);
}

function printSlowestTests(): void {
  if (!existsSync(TIMING_REPORT)) return;
  const junit = readFileSync(TIMING_REPORT, "utf-8");

  for (const [tier, spawn] of [
    ["fast", false],
    ["spawn", true],
  ] as const) {
    const lines = slowestTests(junit, SLOWEST_PER_TIER, spawn);
    if (lines.length === 0) continue;
    console.log(`\nSlowest ${lines.length} ${tier} tests:`);
    for (const line of lines) console.log(line);
  }
}

function runTests(args: string[]): number {
  const result = Bun.spawnSync(
    [
      "bun",
      "test",
      "--randomize",
      "--isolate",
      `--parallel=${workersForThisPlatform()}`,
      ...timingReportArgs(),
      ...args.filter((arg) => !(arg in TIERS)),
      ...tierFiles(args),
    ],
    { stdio: ["inherit", "inherit", "inherit"] }
  );
  printSlowestTests();
  return result.exitCode ?? 1;
}

if (import.meta.main) process.exit(runTests(process.argv.slice(2)));
