import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

// RtkWrap delegates to `rtk hook <agent>` when rtk is on PATH, forwarding its
// stdout verbatim. We stub rtk with a fake executable so these tests are
// deterministic and don't depend on a real rtk being installed on CI.
//
// Tests that must actually EXECUTE the fake prepend the temp dir to the real
// PATH, so the fake shadows any real rtk while `node` still resolves for the
// launcher. The fake's logic is JavaScript on both platforms; only the launcher
// differs — a shebang on POSIX, a .cmd shim on Windows, which is what
// findBinaryOnPath resolves there via PATHEXT.

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "RtkWrap.ts");
const FAKE_OUTPUT = '{"hookSpecificOutput":{"updatedInput":{"command":"rtk FAKE"}}}';
const WINDOWS = process.platform === "win32";

let dir: string;

/** Install a fake `rtk` on PATH whose body runs once stdin has been drained. */
function writeFakeRtk(body: string): void {
  const script = `const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>{${body}});`;
  if (WINDOWS) {
    writeFileSync(resolve(dir, "rtk.js"), script);
    writeFileSync(resolve(dir, "rtk.cmd"), `@echo off\r\nnode "%~dp0rtk.js" %*\r\n`);
    return;
  }
  const p = resolve(dir, "rtk");
  writeFileSync(p, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(p, 0o755);
}

/** PATH containing the fake rtk first, then the real PATH (for shebang tools). */
function shadowPath(): string {
  return `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

async function runHook(env: Record<string, string>, stdin = "{}"): Promise<string> {
  const proc = Bun.spawn([process.execPath, "run", HOOK], {
    env,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "rtk-wrap-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RtkWrap", () => {
  test("forwards rtk hook stdout verbatim when rtk is present", async () => {
    writeFakeRtk(
      `if(process.argv[2]==="hook")process.stdout.write(${JSON.stringify(FAKE_OUTPUT)});`
    );
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "claude" });
    expect(out).toBe(FAKE_OUTPUT);
  });

  // The fake writes a well-formed rewrite to stdout *and* fails. Only the exit
  // code can suppress it, so this stays honest about what it is testing —
  // a fake that failed silently would pass even with the guard removed.
  test("fail-open: rtk exits non-zero → its stdout is discarded", async () => {
    writeFakeRtk(
      `process.stdout.write(${JSON.stringify(FAKE_OUTPUT)});process.stderr.write("boom");process.exitCode=1;`
    );
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "claude" });
    expect(out).toBe("");
  });

  test("fail-open: rtk absent → no output, command unchanged", async () => {
    const out = await runHook({ PATH: dir, PAL_AGENT: "claude" });
    expect(out).toBe("");
  });

  test("no-op for codex (allow/deny only — cannot rewrite)", async () => {
    writeFakeRtk(`process.stdout.write(${JSON.stringify(FAKE_OUTPUT)});`);
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "codex" });
    expect(out).toBe("");
  });

  test("no-op for opencode (handled by plugin, not this hook)", async () => {
    writeFakeRtk(`process.stdout.write(${JSON.stringify(FAKE_OUTPUT)});`);
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "opencode" });
    expect(out).toBe("");
  });
});
