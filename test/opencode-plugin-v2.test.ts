import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentDirOverrides } from "../src/core/paths";
import { reload } from "../src/core/settings";
import { freshTestDir } from "./lib/test-home";

// The V2 context shapes follow @opencode/plugin 2.4.2's promise API types.

type Hook = (event: Record<string, unknown>) => Promise<void> | void;

let home: string;

function streamed(type: string): Record<string, unknown>[] {
  const dir = resolve(home, "records", "bronze", "events");
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

function fakeV2Context(transcript: Record<string, unknown>[] = []) {
  const hooks = new Map<string, Hook>();
  const contextCalls: string[] = [];
  const domain = (prefix: string) => ({
    hook: async (name: string, cb: Hook) => {
      hooks.set(`${prefix}.${name}`, cb);
    },
  });
  const ctx = {
    location: { directory: home },
    tool: domain("tool"),
    permission: domain("permission"),
    shell: domain("shell"),
    session: {
      ...domain("session"),
      context: async ({ sessionID }: { sessionID: string }) => {
        contextCalls.push(sessionID);

        return transcript;
      },
    },
    event: { subscribe: async function* () {} },
  };

  return { ctx, hooks, contextCalls };
}

async function plugin() {
  for (const { env } of agentDirOverrides()) process.env[env] = resolve(home, env);
  const { default: palPlugin } = await import("../src/targets/opencode/plugin");

  return palPlugin;
}

async function setUp(transcript?: Record<string, unknown>[]) {
  const fake = fakeV2Context(transcript);
  const cleanup = await (await plugin()).setup(fake.ctx as never);

  return { ...fake, cleanup };
}

function hook(hooks: Map<string, Hook>, name: string): Hook {
  const found = hooks.get(name);
  if (!found) throw new Error(`hook ${name} was not registered`);

  return found;
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "opencode";
  mkdirSync(resolve(home, "memory"), { recursive: true });
  reload();
});

describe("the opencode plugin's default export", () => {
  test("satisfies both loaders: an id with V2's setup and V1's server", async () => {
    const palPlugin = await plugin();

    expect(typeof palPlugin.id).toBe("string");
    expect(palPlugin.id.length).toBeGreaterThan(0);
    expect(typeof palPlugin.setup).toBe("function");
    expect(typeof palPlugin.server).toBe("function");
  });
});

describe("the opencode V2 setup", () => {
  test("registers every hook PAL relies on", async () => {
    const { hooks } = await setUp();

    expect([...hooks.keys()].sort()).toEqual([
      "permission.evaluate",
      "session.context",
      "session.experimental.idle",
      "session.prompt",
      "shell.create.before",
      "tool.execute.after",
      "tool.execute.before",
    ]);
  });

  test("rejects a dangerous shell command before it runs", async () => {
    const { hooks } = await setUp();
    const event = {
      tool: "shell",
      sessionID: "ses_v2",
      id: "call_1",
      input: { command: "rm -rf /" },
    };

    expect(() => hook(hooks, "tool.execute.before")(event)).toThrow("PAL Security");
  });

  test("lets a write to an ordinary file through", async () => {
    const { hooks } = await setUp();
    const path = resolve(home, "..", "project", "notes.md");
    const event = { tool: "write", sessionID: "ses_v2", id: "call_2", input: { path } };

    expect(() => hook(hooks, "tool.execute.before")(event)).not.toThrow();
  });

  test("rejects a write to a protected file", async () => {
    const { hooks } = await setUp();
    const path = "/home/user/.ssh/id_rsa";
    const event = { tool: "write", sessionID: "ses_v2", id: "call_4", input: { path } };

    expect(() => hook(hooks, "tool.execute.before")(event)).toThrow("PAL Security");
  });

  test("records a finished tool call", async () => {
    const { hooks } = await setUp();
    await hook(
      hooks,
      "tool.execute.after"
    )({
      tool: "read",
      sessionID: "ses_v2",
      id: "call_3",
      input: { path: "README.md" },
      status: "completed",
      result: { content: [{ type: "text", text: "hello" }] },
    });

    expect(streamed("tool_call").map((e) => e.tool)).toContain("read");
  });

  test("swallows a failing hook instead of failing the session", async () => {
    const { hooks } = await setUp();

    await expect(hook(hooks, "tool.execute.after")({})).resolves.toBeUndefined();
  });

  test("passes PAL_DIR to every shell opencode creates", async () => {
    const { hooks } = await setUp();
    const event = { env: {} as Record<string, string> };
    await hook(hooks, "shell.create.before")(event);

    expect(event.env.PAL_DIR).toBeTruthy();
  });

  test("reads the idle session's transcript for the stop handlers", async () => {
    const { hooks, contextCalls } = await setUp([{ type: "user", text: "hi" }]);
    await hook(
      hooks,
      "session.experimental.idle"
    )({ sessionID: "ses_idle", background: [] });

    expect(contextCalls).toEqual(["ses_idle"]);
  });

  test("returns a cleanup for opencode to call on dispose", async () => {
    const { cleanup } = await setUp();

    expect(typeof cleanup).toBe("function");
  });
});
