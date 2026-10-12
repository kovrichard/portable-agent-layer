import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKERS = 4;
const REPOS = 100;
const CLI_RUNS = 100;
const GIVE_UP_MS = 120_000;
const ROOT = resolve(process.cwd(), ".test", "spawn-bench");

interface Sample {
  command: string;
  ms: number;
  hung: boolean;
}

function timed(command: string, cmd: string, args: string[], cwd: string): Sample {
  const started = performance.now();
  const result = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: GIVE_UP_MS });
  const ms = Math.round(performance.now() - started);
  const hung = result.signal !== null || result.error !== undefined;
  if (ms > 1000 || hung || result.status !== 0)
    process.stderr.write(
      `BENCHSLOW ${ms}ms ${command} status=${result.status} signal=${result.signal}\n`
    );
  return { command, ms, hung };
}

function gitIn(dir: string, command: string, ...args: string[]): Sample {
  const identity = [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "-c",
    "init.defaultBranch=main",
  ];
  return timed(`git ${command}`, "git", [...identity, ...args], dir);
}

function benchOneRepo(dir: string): Sample[] {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "a"), "a");
  return [
    gitIn(dir, "init", "init", "-q"),
    gitIn(dir, "add", "add", "a"),
    gitIn(dir, "commit", "commit", "-qm", "a"),
    gitIn(dir, "tag", "tag", "v1.0.0"),
    gitIn(dir, "rev-parse", "rev-parse", "--show-toplevel"),
    gitIn(dir, "status", "status", "--porcelain=v2", "--branch"),
  ];
}

function runWorker(kind: string, pass: string, index: number): Sample[] {
  const samples: Sample[] = [];
  if (kind === "git") {
    for (let repo = index; repo < REPOS; repo += WORKERS)
      samples.push(...benchOneRepo(resolve(ROOT, pass, `r${repo}`)));
  } else {
    for (let run = index; run < CLI_RUNS; run += WORKERS)
      samples.push(
        timed(
          "bun cli --help",
          "bun",
          ["run", "src/cli/index.ts", "cli", "--help"],
          process.cwd()
        )
      );
  }
  return samples;
}

async function runWorkers(kind: string, pass: string): Promise<Sample[]> {
  const workers = Array.from({ length: WORKERS }, (_, index) =>
    Bun.spawn(["bun", import.meta.path, "--worker", kind, pass, String(index)], {
      stdout: "pipe",
      stderr: "inherit",
    })
  );
  const outputs = await Promise.all(
    workers.map((worker) => new Response(worker.stdout).text())
  );
  return outputs.flatMap((output) => JSON.parse(output) as Sample[]);
}

function percentile(sorted: number[], p: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
  );
}

function report(pass: string, samples: Sample[]) {
  for (const command of [...new Set(samples.map((s) => s.command))]) {
    const mine = samples.filter((s) => s.command === command);
    const ms = mine.map((s) => s.ms).sort((a, b) => a - b);
    const over = (limit: number) => ms.filter((m) => m > limit).length;
    console.log(
      `BENCH pass=${pass} cmd="${command}" n=${ms.length} p50=${percentile(ms, 50)} p95=${percentile(ms, 95)} p99=${percentile(ms, 99)} max=${ms.at(-1)} over1s=${over(1000)} over5s=${over(5000)} hung=${mine.filter((s) => s.hung).length}`
    );
  }
}

async function benchPass(pass: string) {
  const started = performance.now();
  const samples = [
    ...(await runWorkers("git", pass)),
    ...(await runWorkers("cli", pass)),
  ];
  report(pass, samples);
  console.log(`BENCH pass=${pass} wall=${Math.round(performance.now() - started)}ms`);
}

function reportDefenderState() {
  const script = `$s = Get-MpComputerStatus; "REALTIME=" + $s.RealTimeProtectionEnabled + " ONACCESS=" + $s.OnAccessProtectionEnabled + " EXCLUSIONS=" + ((Get-MpPreference).ExclusionPath -join ';')`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf-8",
  });
  console.log(
    `BENCH defender status=${result.status} ${result.stdout.trim()} ${result.stderr.trim()}`
  );
}

async function main() {
  if (process.platform !== "win32") {
    console.log("spawn-bench: Windows only, skipped");
    return;
  }
  reportDefenderState();
  rmSync(ROOT, { recursive: true, force: true });
  await benchPass("first");
  await benchPass("second");
  rmSync(ROOT, { recursive: true, force: true });
}

if (process.argv[2] === "--worker") {
  const [, , , kind = "", pass = "", index = "0"] = process.argv;
  process.stdout.write(JSON.stringify(runWorker(kind, pass, Number(index))));
} else {
  await main();
}
