import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimChecksSince } from "../src/hooks/lib/claim-log";
import { eventsSince } from "../src/hooks/lib/events";
import { invocationContext } from "../src/hooks/lib/invocation-context";
import { palHome, paths } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";
import {
  CONVERSATION,
  DANGEROUS,
  freshAgySandbox,
  injectedText,
  preInvocation,
  runCommand,
  SUBAGENT_OPENING,
  said,
  startUserTurnUnderAgy,
  stop,
  userInput,
  writeTranscript,
} from "./lib/antigravity-hooks-fixture";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const HOOKS = resolve(import.meta.dir, "../src/hooks");

let workspace: string;

beforeEach(() => {
  ({ workspace } = freshAgySandbox(import.meta.file));
});

// Bun.spawn hands a child the environment the process started with, which lacks
// both this sandbox and the preload's PAL_TEST_SANDBOX, so it is passed by hand.
function runStopOrchestrator(payload: Record<string, unknown>) {
  return Bun.spawnSync(
    ["bun", "run", resolve(HOOKS, "StopOrchestrator.ts"), "--agent=antigravity"],
    {
      stdin: new TextEncoder().encode(JSON.stringify(payload)),
      stderr: "ignore",
      env: process.env,
    }
  );
}

describe("SecurityValidator under agy", () => {
  // Bun.spawn hands a child the environment the process started with, which lacks
  // both this sandbox and the preload's PAL_TEST_SANDBOX, so it is passed by hand.
  async function runValidator(stdin: string) {
    const proc = Bun.spawn(
      ["bun", "run", resolve(HOOKS, "SecurityValidator.ts"), "--agent=antigravity"],
      {
        stdin: new TextEncoder().encode(stdin),
        stdout: "pipe",
        stderr: "ignore",
        env: process.env,
      }
    );
    const out = await new Response(proc.stdout).text();
    return { out: out.trim(), code: await proc.exited };
  }

  test("prints agy's deny for a dangerous command", async () => {
    const { out, code } = await runValidator(JSON.stringify(runCommand(DANGEROUS)));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ decision: "deny", reason: expect.any(String) });
  });

  test("records the refusal against agy's workspace, not the folder it ran from", async () => {
    await runValidator(JSON.stringify(runCommand(DANGEROUS)));
    const ledger = readFileSync(resolve(paths.ledger(), "actions.jsonl"), "utf-8");
    expect(JSON.parse(ledger.trim().split("\n")[0]).target).toBe(workspace);
  });

  // agy blocks the tool on any stdout or any non-zero exit, so silence is the only allow.
  test("prints nothing for a harmless one", async () => {
    expect(await runValidator(JSON.stringify(runCommand("ls -la")))).toEqual({
      out: "",
      code: 0,
    });
  });

  test("prints nothing for stdin it cannot read", async () => {
    expect(await runValidator("not json")).toEqual({ out: "", code: 0 });
  });
});

describe("which agy stops end a turn of the user's", () => {
  // The debug log names every stop handler that starts, so its silence shows none did.
  test("StopOrchestrator never starts the stop handlers for a side stop", () => {
    writeTranscript(SUBAGENT_OPENING);
    writeFileSync(resolve(paths.state(), "debug-enabled"), "", "utf-8");
    const proc = runStopOrchestrator(stop());
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toBe("");
    const debugLog = resolve(paths.debug(), "debug.log");
    expect(existsSync(debugLog) ? readFileSync(debugLog, "utf-8") : "").not.toContain(
      "stopTurn"
    );
  });
});

describe("StopOrchestrator on a turn of the user's", () => {
  test("checks the claims in the reply it read off the transcript", () => {
    reload();
    writeTranscript(userInput("run the tests"), said("All tests pass."));
    const proc = runStopOrchestrator(stop());
    expect(proc.exitCode).toBe(0);
    reload();
    expect(claimChecksSince(new Date(0))).toEqual([
      expect.objectContaining({
        session: CONVERSATION,
        verdict: "unbacked",
        commands: 0,
      }),
    ]);
  });
});

describe("PreInvocation injects context as one user step", () => {
  beforeEach(startUserTurnUnderAgy);

  test("the first turn carries the session context and the prompt context", async () => {
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).toContain("SEED-NOTE-4471");
    expect(text).toContain("Now:");
  });

  test("a later turn of the same conversation carries the prompt context alone", async () => {
    await invocationContext(preInvocation(0));
    writeTranscript(userInput("fix the build"), userInput("and the tests"));
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).not.toContain("SEED-NOTE-4471");
    expect(text).toContain("Now:");
  });

  // agy already loads these from the plugin's rules; injecting them again doubles them.
  test("the session context leaves out what agy loads natively", async () => {
    const steering = resolve(palHome(), "docs", "STEERING_RULES.md");
    mkdirSync(resolve(steering, ".."), { recursive: true });
    writeFileSync(steering, "STEERING-9902", "utf-8");
    const text = injectedText(await invocationContext(preInvocation(0)));
    expect(text).toContain("SEED-NOTE-4471");
    expect(text).not.toContain("STEERING-9902");
  });

  test("the prompt is captured like any other agent's, here as the session name", async () => {
    await invocationContext(preInvocation(0));
    const names = readFileSync(resolve(paths.state(), "session-names.json"), "utf-8");
    expect(JSON.parse(names)[CONVERSATION]).toBeString();
  });

  test("only the most recent conversations are remembered", async () => {
    const started = resolve(paths.state(), "antigravity-conversations.json");
    const older = Array.from({ length: 200 }, (_, i) => `older-${i}`);
    writeFileSync(started, JSON.stringify(older), "utf-8");
    await invocationContext(preInvocation(0));
    const kept = JSON.parse(readFileSync(started, "utf-8"));
    expect(kept).toHaveLength(200);
    expect(kept.at(-1)).toBe(CONVERSATION);
    expect(kept).not.toContain("older-0");
  });

  test("a turn's prompt hook is timed, handler by handler, like UserPromptSubmit", async () => {
    await invocationContext(preInvocation(0));
    expect(eventsSince("hook_timing", new Date(0))).toEqual([
      expect.objectContaining({
        session: CONVERSATION,
        hook: "prompt",
        handlers: {
          "session-context": expect.any(Number),
          "inject-context": expect.any(Number),
          capture: expect.any(Number),
        },
      }),
    ]);
  });
});
