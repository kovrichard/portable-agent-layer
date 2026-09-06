import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { HandoffEntry } from "../src/tools/agent/handoff-note";

// The handoff note is where an agent says what it could not finish. One of those
// reasons — waiting on the human — is the only one the morning screen can act on,
// so it has to survive the round trip as its own field.

const CLI = resolve(import.meta.dir, "../src/tools/agent/handoff-note.ts");
let HOME: string;
let CWD: string;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-handoff-"));
  CWD = mkdtempSync(resolve(tmpdir(), "pal-handoff-cwd-"));
});

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(CWD, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<number> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: CWD,
    env: { ...process.env, PAL_HOME: HOME },
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exited;
}

function stored(): HandoffEntry {
  const raw = readFileSync(
    resolve(HOME, "memory", "state", "last-handoff.json"),
    "utf-8"
  );
  return (JSON.parse(raw) as Record<string, HandoffEntry>)[CWD];
}

describe("handoff-note --waiting", () => {
  test("what the work needs from the human is recorded on its own", async () => {
    expect(
      await runCli([
        "--title",
        "the pricing page",
        "--text",
        "copy is drafted, the numbers are not",
        "--waiting",
        "a decision on the tiers",
      ])
    ).toBe(0);
    const entry = stored();
    expect(entry.waitingOn).toBe("a decision on the tiers");
    expect(entry.status).toBe("in-progress");
    expect(entry.handoff).toBe("copy is drafted, the numbers are not");
  });

  test("a note without the flag carries no waiting line at all", async () => {
    await runCli(["--title", "t", "--text", "unfinished"]);
    expect(stored()).not.toHaveProperty("waitingOn");
  });

  test("closing a session does not leave a stale waiting line behind", async () => {
    await runCli(["--title", "t", "--text", "x", "--waiting", "an answer"]);
    await runCli(["--done"]);
    const entry = stored();
    expect(entry.status).toBe("completed");
    expect(entry).not.toHaveProperty("waitingOn");
  });

  test("a note still needs both a title and text", async () => {
    expect(await runCli(["--waiting", "an answer"])).toBe(1);
  });
});
