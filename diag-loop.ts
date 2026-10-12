const workers = Number(process.env.DIAG_WORKERS ?? 4);
const runs = process.platform === "win32" ? 5 : 1;
let failed = false;
for (let run = 1; run <= runs; run++) {
  const started = performance.now();
  const result = Bun.spawnSync(
    ["bun", "test", "--randomize", "--isolate", `--parallel=${workers}`],
    { stdout: "inherit", stderr: "inherit" }
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`DIAGRUN workers=${workers} run=${run} exit=${result.exitCode} wall=${seconds}s`);
  if (result.exitCode !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
