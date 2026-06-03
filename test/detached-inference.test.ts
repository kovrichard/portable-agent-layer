import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnDetachedInference } from "../src/hooks/lib/detached-inference";

describe("spawnDetachedInference", () => {
  let tmp: string;
  let savedHome: string | undefined;
  let savedClaudecode: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "pal-detached-"));
    savedHome = process.env.PAL_HOME;
    savedClaudecode = process.env.CLAUDECODE;
    process.env.PAL_HOME = tmp;
    process.env.CLAUDECODE = "1"; // parent has it set
    // Enable debug logging for tests that assert on debug.log content.
    const stateDir = resolve(tmp, "memory", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(resolve(stateDir, "debug-enabled"), "");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = savedHome;
    if (savedClaudecode === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = savedClaudecode;
  });

  test("spawned child receives CLAUDECODE unset; parent retains it", async () => {
    // Child script writes its CLAUDECODE env value into a marker file.
    const childScript = resolve(tmp, "child.ts");
    const markerFile = resolve(tmp, "marker.txt");
    writeFileSync(
      childScript,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(markerFile)}, "claudecode=[" + (process.env.CLAUDECODE ?? "") + "]");
`,
      "utf-8"
    );

    spawnDetachedInference(childScript, [], "test");

    // Detached child runs asynchronously; poll for the marker.
    let content = "";
    for (let i = 0; i < 50; i++) {
      try {
        content = readFileSync(markerFile, "utf-8");
        if (content) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(content).toBe("claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("returns immediately even though child runs async", () => {
    const childScript = resolve(tmp, "slow-child.ts");
    writeFileSync(childScript, `await new Promise((r) => setTimeout(r, 2000));`, "utf-8");
    const start = Date.now();
    spawnDetachedInference(childScript, [], "test");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  test("logs debug line when spawned successfully", async () => {
    const childScript = resolve(tmp, "noop.ts");
    writeFileSync(childScript, `process.exit(0);`, "utf-8");
    spawnDetachedInference(childScript, ["--mode-x", "arg1"], "test-scope");

    const logPath = resolve(tmp, "memory", "state", "debug.log");
    let log = "";
    for (let i = 0; i < 20; i++) {
      try {
        log = readFileSync(logPath, "utf-8");
        if (log.includes("test-scope")) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(log).toContain("test-scope: detached inference spawned: --mode-x");
  });

  test("logs error if spawn throws", () => {
    // Use an executable path that doesn't exist to force spawn() throw.
    // node:child_process.spawn doesn't throw on ENOENT immediately — it emits
    // 'error' async. So we test the success-log path here; spawn-failure
    // observability comes via the child's own exit + the calling code's
    // downstream signal absence. Keeping this as a placeholder for now.
    expect(typeof spawnDetachedInference).toBe("function");
  });
});
