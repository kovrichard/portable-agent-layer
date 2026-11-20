import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { reflectionsFile } from "../src/bronze/bronze";
import { run } from "../src/tools/agent/algorithm-reflect";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
const ARGS = ["--task", "t", "--q1", "a", "--q2", "b", "--q3", "c"];
const SHELL_ENV = ["PAL_AGENT", "CLAUDE_CODE_SESSION_ID"] as const;

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(HOME, { recursive: true });
});

type ShellEnv = Partial<Record<(typeof SHELL_ENV)[number], string>>;

function setShellEnv(env: ShellEnv): void {
  for (const name of SHELL_ENV) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
}

async function reflectInShell(env: ShellEnv): Promise<number> {
  const saved = Object.fromEntries(SHELL_ENV.map((name) => [name, process.env[name]]));
  setShellEnv(env);

  try {
    return await run(ARGS);
  } finally {
    setShellEnv(saved);
  }
}

function lastReflection(): Record<string, unknown> {
  const lines = readFileSync(reflectionsFile(), "utf-8").trim().split("\n");

  return JSON.parse(lines[lines.length - 1]);
}

describe("algorithm-reflect — session", () => {
  test("records the session the agent exported to its shell", async () => {
    const code = await reflectInShell({
      PAL_AGENT: "claude",
      CLAUDE_CODE_SESSION_ID: "session-1",
    });

    expect(code).toBe(0);
    expect(lastReflection().session).toBe("session-1");
  });

  test("still writes the reflection, without a session key, when the session is unknown", async () => {
    const code = await reflectInShell({
      PAL_AGENT: "claude",
      CLAUDE_CODE_SESSION_ID: undefined,
    });

    expect(code).toBe(0);
    const reflection = lastReflection();
    expect(reflection.task).toBe("t");
    expect(Object.hasOwn(reflection, "session")).toBe(false);
  });
});
