import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";

// RtkWrap delegates to `rtk hook <agent>` when rtk is on PATH, forwarding its
// stdout verbatim. We stub rtk with a fake executable so these tests are
// deterministic and don't depend on a real rtk being installed on CI.
//
// Tests that must actually EXECUTE the fake prepend the temp dir to the real
// PATH (so the fake shadows any real rtk while its bash shebang still resolves)
// and are POSIX-only. The fail-open / no-op cases use an isolated PATH and run
// everywhere — those paths never spawn a subprocess.

const HOOK = resolve(import.meta.dir, "..", "src", "hooks", "RtkWrap.ts");
const FAKE_OUTPUT = '{"hookSpecificOutput":{"updatedInput":{"command":"rtk FAKE"}}}';
const POSIX = process.platform !== "win32";

let dir: string;

function writeFakeRtk(body: string): void {
  const p = resolve(dir, "rtk");
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
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
  test.if(POSIX)("forwards rtk hook stdout verbatim when rtk is present", async () => {
    writeFakeRtk(
      `if [ "$1" = "hook" ]; then cat >/dev/null; echo -n '${FAKE_OUTPUT}'; fi`
    );
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "claude" });
    expect(out).toBe(FAKE_OUTPUT);
  });

  test.if(POSIX)("fail-open: rtk exits non-zero → no output", async () => {
    writeFakeRtk("cat >/dev/null; echo -n 'boom' 1>&2; exit 1");
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "claude" });
    expect(out).toBe("");
  });

  test("fail-open: rtk absent → no output, command unchanged", async () => {
    const out = await runHook({ PATH: dir, PAL_AGENT: "claude" });
    expect(out).toBe("");
  });

  test("no-op for codex (allow/deny only — cannot rewrite)", async () => {
    writeFakeRtk(`echo -n '${FAKE_OUTPUT}'`);
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "codex" });
    expect(out).toBe("");
  });

  test("no-op for opencode (handled by plugin, not this hook)", async () => {
    writeFakeRtk(`echo -n '${FAKE_OUTPUT}'`);
    const out = await runHook({ PATH: shadowPath(), PAL_AGENT: "opencode" });
    expect(out).toBe("");
  });
});
