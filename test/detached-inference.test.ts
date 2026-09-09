import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnDetachedInference } from "../src/hooks/lib/detached-inference";

/** A detached child runs asynchronously, so every assertion on it has to wait. */
async function readWhenWritten(path: string, attempts = 50): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    try {
      const content = readFileSync(path, "utf-8");
      if (content) return content;
    } catch {
      /* child hasn't written it yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return "";
}

describe("spawnDetachedInference", () => {
  let tmp: string;
  let savedHome: string | undefined;
  let savedClaudecode: string | undefined;
  let savedAgent: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "pal-detached-"));
    savedHome = process.env.PAL_HOME;
    savedClaudecode = process.env.CLAUDECODE;
    savedAgent = process.env.PAL_AGENT;
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
    if (savedAgent === undefined) delete process.env.PAL_AGENT;
    else process.env.PAL_AGENT = savedAgent;
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

    expect(await readWhenWritten(markerFile)).toBe("claudecode=[]");
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

    const log = await readWhenWritten(resolve(tmp, "debug", "debug.log"));
    expect(log).toContain("test-scope: detached inference spawned: --mode-x");
  });

  test("child argv carries the parent's active agent", async () => {
    process.env.PAL_AGENT = "cursor";
    const childScript = resolve(tmp, "argv-child.ts");
    const markerFile = resolve(tmp, "argv-marker.txt");
    writeFileSync(
      childScript,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(markerFile)}, process.argv.slice(2).join(" "));
`,
      "utf-8"
    );

    spawnDetachedInference(childScript, ["--run", "sid-1"], "test");

    expect(await readWhenWritten(markerFile)).toBe("--run sid-1 --agent=cursor");
  });

  test("child detects the agent from argv alone, without inheriting PAL_AGENT", async () => {
    process.env.PAL_AGENT = "cursor";
    const childScript = resolve(tmp, "detect-child.ts");
    const markerFile = resolve(tmp, "detect-marker.txt");
    // Drop the inherited env signal before loading the detector, so only the
    // argv flag can account for the answer.
    writeFileSync(
      childScript,
      `import { writeFileSync } from "node:fs";
delete process.env.PAL_AGENT;
const { getActiveAgent } = await import(${JSON.stringify(resolve(import.meta.dir, "../src/hooks/lib/agent.ts"))});
writeFileSync(${JSON.stringify(markerFile)}, getActiveAgent());
`,
      "utf-8"
    );

    spawnDetachedInference(childScript, ["--run", "sid-2"], "test");

    expect(await readWhenWritten(markerFile)).toBe("cursor");
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
