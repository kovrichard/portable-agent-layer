import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// The lifecycle is the only part of the server with real failure surface:
// a process that outlives its shell has to be found again to be stopped, and
// a record of one that has already gone must not stop `start` from working.

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

let HOME: string;
let PORT: number;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-server-cli-"));
  PORT = 17000 + Math.floor(Math.random() * 2000);
});

afterEach(() => {
  pal("stop");
  rmSync(HOME, { recursive: true, force: true });
});

function pal(...args: string[]) {
  return spawnSync("bun", ["run", CLI, "cli", "server", ...args], {
    env: { ...process.env, PAL_HOME: HOME, PAL_SKIP_DOCTOR: "1" },
    encoding: "utf-8",
    timeout: 15000,
  });
}

function stateFile(): string {
  return resolve(HOME, "server.json");
}

function recordedPid(): number {
  return (JSON.parse(readFileSync(stateFile(), "utf-8")) as { pid: number }).pid;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function untilGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await Bun.sleep(50);
  }
  return false;
}

describe("pal cli server", () => {
  test("start answers after the launching command has exited", async () => {
    const started = pal("start", "--port", String(PORT));
    expect(started.status).toBe(0);
    expect(started.stdout).toContain(`http://127.0.0.1:${PORT}/`);

    const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
    expect(res.status).toBe(200);
    expect(existsSync(stateFile())).toBe(true);
    expect(alive(recordedPid())).toBe(true);
  });

  test("start again reports the running one instead of a second", () => {
    pal("start", "--port", String(PORT));
    const pid = recordedPid();

    const again = pal("start", "--port", String(PORT));
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Already running");
    expect(recordedPid()).toBe(pid);
  });

  test("stop kills the process and forgets it", async () => {
    pal("start", "--port", String(PORT));
    const pid = recordedPid();

    const stopped = pal("stop");
    expect(stopped.status).toBe(0);
    expect(await untilGone(pid)).toBe(true);
    expect(existsSync(stateFile())).toBe(false);
  });

  test("stop with a stale record clears it and says so", () => {
    writeFileSync(
      stateFile(),
      JSON.stringify({
        pid: 2147483000,
        port: PORT,
        startedAt: "2026-09-01T00:00:00.000Z",
      })
    );

    const stopped = pal("stop");
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain("already gone");
    expect(existsSync(stateFile())).toBe(false);
  });

  test("start after a stale record starts fresh", () => {
    writeFileSync(
      stateFile(),
      JSON.stringify({
        pid: 2147483000,
        port: PORT,
        startedAt: "2026-09-01T00:00:00.000Z",
      })
    );

    const started = pal("start", "--port", String(PORT));
    expect(started.status).toBe(0);
    expect(recordedPid()).not.toBe(2147483000);
  });

  test("status says not running, with exit 1, when nothing is", () => {
    const status = pal("status");
    expect(status.status).toBe(1);
    expect(status.stdout).toContain("Not running");
  });

  test("status names the running server", () => {
    pal("start", "--port", String(PORT));
    const status = pal("status");
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(`http://127.0.0.1:${PORT}/`);
    expect(status.stdout).toContain(`pid          ${recordedPid()}`);
  });

  test("a port that is not a number is refused", () => {
    const started = pal("start", "--port", "lots");
    expect(started.status).toBe(1);
    expect(started.stderr).toContain("--port");
  });
});
