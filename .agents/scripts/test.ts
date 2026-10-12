/** Windows CI runners stall on process spawns at 4 workers, enough to push a test past the 5 s limit. */
function workersForThisPlatform(): number {
  return process.platform === "win32" ? 2 : 4;
}

const result = Bun.spawnSync(
  [
    "bun",
    "test",
    "--randomize",
    "--isolate",
    `--parallel=${workersForThisPlatform()}`,
    ...process.argv.slice(2),
  ],
  { stdio: ["inherit", "inherit", "inherit"] }
);
process.exit(result.exitCode ?? 1);
