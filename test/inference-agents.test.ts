import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildAntigravityArgs,
  buildCodexArgs,
  buildCopilotArgs,
  buildOpencodeArgs,
  CODEX_REPLY,
  extractOpencodeText,
  inferenceViaAntigravitySpawn,
  inferenceViaClaudeSpawn,
  inferenceViaCopilotSpawn,
  inferenceViaOpencodeSpawn,
  loggedClaudeAuthMode,
} from "../src/hooks/lib/inference-agents";
import { schemaInstruction } from "../src/hooks/lib/inference-prompt";
import type { InferenceOptions, InferenceResult } from "../src/hooks/lib/inference-types";
import { debugHome, type FakeRun, type SpawnCall, withFakeSpawn } from "./lib/fake-spawn";
import { restoreEnv, savedEnv } from "./lib/inference-dispatch-fixture";

const BASELINE = savedEnv();
const SCOPED_ENV = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "COPILOT_HOME",
];
let home = { home: "", log: () => "" };

function clearScopedEnv() {
  for (const name of SCOPED_ENV) delete process.env[name];
}

beforeEach(() => {
  restoreEnv(BASELINE);
  clearScopedEnv();
  home = debugHome(import.meta.file);
});

type Dispatcher = (bin: string, opts: InferenceOptions) => Promise<InferenceResult>;

async function run(
  dispatcher: Dispatcher,
  runs: FakeRun[],
  opts: InferenceOptions = { user: "q" },
  env: Record<string, string> = {}
): Promise<{ result: InferenceResult; calls: SpawnCall[] }> {
  Object.assign(process.env, env);

  try {
    const { value, calls } = await withFakeSpawn(runs, () => dispatcher("bin", opts));

    return { result: value, calls };
  } finally {
    clearScopedEnv();
  }
}

const line = (value: unknown) => JSON.stringify(value);
const claudeOut = (fields: Record<string, unknown>) =>
  line({ type: "result", ...fields });

function envOf(call: SpawnCall): Record<string, string | undefined> {
  return call.options.env as Record<string, string | undefined>;
}

describe("claude spawn", () => {
  const claude = (
    runs: FakeRun[],
    opts?: InferenceOptions,
    env?: Record<string, string>
  ) => run(inferenceViaClaudeSpawn, runs, opts, env);

  test("returns the trimmed result and sends the user text on stdin", async () => {
    const { result, calls } = await claude(
      [{ stdout: claudeOut({ result: "  hi  " }) }],
      {
        user: "question",
      }
    );

    expect(result.output).toBe("hi");
    expect(calls[0].writes).toEqual(["question"]);
    expect(calls[0].argv).not.toContain("--system-prompt-file");
  });

  test.each([
    ["an error result", claudeOut({ result: "denied", is_error: true })],
    ["a result without text", claudeOut({})],
    ["no result event", line({ type: "other" })],
  ])("%s fails", async (_name, stdout) => {
    expect((await claude([{ stdout }])).result.success).toBe(false);
  });

  test("an OAuth token drops the keys that outrank it and tags the log", async () => {
    const { calls } = await claude([{ stdout: claudeOut({ result: "ok" }) }], undefined, {
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      ANTHROPIC_API_KEY: "key",
    });

    expect(envOf(calls[0]).ANTHROPIC_API_KEY).toBeUndefined();
    expect(envOf(calls[0])).toHaveProperty("ANTHROPIC_AUTH_TOKEN", undefined);
    expect(home.log()).toContain("auth=token done");
  });

  test("the native login keeps the environment's keys", async () => {
    const { calls } = await claude([{ stdout: claudeOut({ result: "ok" }) }], undefined, {
      ANTHROPIC_API_KEY: "key",
    });

    expect(envOf(calls[0]).ANTHROPIC_API_KEY).toBe("key");
    expect(home.log()).toContain("auth=native done");
  });

  async function systemFileSent(opts: InferenceOptions) {
    let file = "";
    let content = "";
    await claude(
      [
        {
          stdout: claudeOut({ result: "ok" }),
          onSpawn: (argv) => {
            file = argv[argv.indexOf("--system-prompt-file") + 1];
            content = readFileSync(file, "utf-8");
          },
        },
      ],
      opts
    );

    return { file, content };
  }

  test("the system prompt goes through a file that is removed afterwards", async () => {
    const { file, content } = await systemFileSent({ user: "q", system: "be brief" });

    expect(content).toBe("be brief");
    expect(basename(file)).toBe("system-prompt.md");
    expect(basename(resolve(file, ".."))).toStartWith("pal-system-");
    expect(existsSync(resolve(file, ".."))).toBe(false);
  });

  test("a schema alone becomes the system prompt", async () => {
    const schema = { type: "object" };
    const { content } = await systemFileSent({ user: "q", jsonSchema: schema });

    expect(content).toBe(schemaInstruction(schema));
  });
});

describe("loggedClaudeAuthMode", () => {
  test("reads the auth tag, defaulting to native", () => {
    expect(loggedClaudeAuthMode("caller=x auth=token done")).toBe("token");
    expect(loggedClaudeAuthMode("caller=x auth=tokens done")).toBe("native");
    expect(loggedClaudeAuthMode("caller=x done")).toBe("native");
  });
});

describe("codex", () => {
  test("argv is read-only, ephemeral and JSON, with no web or effort by default", () => {
    expect(buildCodexArgs({ user: "q" })).toEqual([
      "exec",
      "-m",
      expect.any(String),
      "--color",
      "never",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--json",
    ]);
  });

  test("web and a large tier add their config flags", () => {
    const args = buildCodexArgs({ user: "q", web: true, tier: "large" });

    expect(args.slice(-4)).toEqual([
      "-c",
      "web_search=live",
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  test("the reply is the last completed agent message", () => {
    const raw = [
      line({ type: "item.completed", item: { type: "agent_message", text: "first" } }),
      line({ type: "item.started", item: { type: "agent_message", text: "started" } }),
      line({ type: "item.completed", item: { type: "agent_message", text: " last " } }),
      line({ type: "item.completed", item: { type: "reasoning", text: "thinking" } }),
      line({ type: "item.completed" }),
    ].join("\n");

    expect(CODEX_REPLY.text(raw)).toBe("last");
  });

  test("no agent message reads as empty", () => {
    const raw = line({ type: "item.completed", item: { type: "agent_message" } });

    expect(CODEX_REPLY.text(raw)).toBe("");
    expect(CODEX_REPLY.text(line({ type: "item.completed" }))).toBe("");
  });
});

describe("opencode", () => {
  test("argv runs pure with JSON output and no model when none is configured", () => {
    expect(buildOpencodeArgs({ user: "q" })).toEqual([
      "run",
      "--pure",
      "--format",
      "json",
    ]);
  });

  test("runs from an empty config dir with external context off, then removes it", async () => {
    const stdout = line({ type: "text", part: { type: "text", text: " ok " } });
    const { result, calls } = await run(inferenceViaOpencodeSpawn, [{ stdout }], {
      user: "q",
      system: "s",
    });
    const cwd = String(calls[0].options.cwd);

    expect(result.output).toBe("ok");
    expect(calls[0].writes).toEqual(["s\n\nq"]);
    expect(basename(cwd)).toStartWith("pal-opencode-");
    expect(envOf(calls[0])).toMatchObject({
      XDG_CONFIG_HOME: cwd,
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    });
    expect(existsSync(cwd)).toBe(false);
  });

  test("extractOpencodeText joins only text parts and skips the rest", () => {
    const raw = [
      "> build banner",
      "",
      "   ",
      line({ type: "text", part: { type: "text", text: " a" } }),
      line({ type: "text", part: { type: "tool", text: "tool" } }),
      line({ type: "step", part: { type: "text", text: "step" } }),
      line({ type: "text" }),
      line({ type: "text", part: { type: "text", text: "" } }),
      line({ type: "text", part: { type: "text", text: "b " } }),
    ].join("\n");

    expect(extractOpencodeText(raw)).toBe("ab");
  });
});

describe("antigravity", () => {
  test("argv streams JSON both ways under the inference agent", () => {
    const args = buildAntigravityArgs({ user: "q" });

    expect(args.slice(0, 4)).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ]);
    expect(args[4]).toBe("--model");
    expect(args[6]).toBe("--agent");
  });

  test("runs from a temporary workspace holding the agent, then removes it", async () => {
    let agentFiles = false;
    const { result, calls } = await run(inferenceViaAntigravitySpawn, [
      {
        stdout: line({
          event: "result",
          result: { status: "SUCCESS", response: " ok " },
        }),
        onSpawn: (_argv, options) => {
          agentFiles = existsSync(resolve(String(options.cwd), ".agents", "agents"));
        },
      },
    ]);
    const cwd = String(calls[0].options.cwd);

    expect(result.output).toBe("ok");
    expect(agentFiles).toBe(true);
    expect(basename(cwd)).toStartWith("pal-antigravity-");
    expect(existsSync(cwd)).toBe(false);
  });
});

describe("copilot", () => {
  const message = (content?: string) =>
    line({ type: "assistant.message", data: { content } });
  const resultLine = (sessionId: string) => line({ type: "result", sessionId });
  const copilot = (stdout: string, env?: Record<string, string>) =>
    run(inferenceViaCopilotSpawn, [{ stdout }], undefined, env);

  function writeShutdown(copilotHome: string, id: string, inputTokens: number) {
    const dir = resolve(copilotHome, "session-state", id);
    mkdirSync(dir, { recursive: true });
    const usage = { inputTokens, outputTokens: 2 };
    writeFileSync(
      resolve(dir, "events.jsonl"),
      line({ type: "session.shutdown", data: { modelMetrics: { m: { usage } } } })
    );
  }

  test("argv hides every tool unless web is asked for", () => {
    const plain = buildCopilotArgs({ user: "q" });
    const web = buildCopilotArgs({ user: "q", web: true });

    expect(plain).toContain("--available-tools=none");
    expect(plain).toContain("--deny-tool=url");
    expect(web).toContain("--available-tools=web_fetch");
    expect(web).toContain("--allow-all-urls");
    expect(web).not.toContain("--deny-tool=url");
  });

  test("the reply is the last non-empty assistant message", async () => {
    const stdout = [
      message("first"),
      line({ type: "user.message", data: { content: "echo" } }),
      message(" second "),
      message("  "),
      line({ type: "assistant.message" }),
    ].join("\n");

    expect((await copilot(stdout)).result.output).toBe("second");
  });

  test("no assistant message fails", async () => {
    const stdout = line({ type: "assistant.message", data: {} });

    expect((await copilot(stdout)).result.success).toBe(false);
  });

  test("a /login account runs in COPILOT_HOME and reads usage from its session file", async () => {
    const copilotHome = resolve(home.home, "copilot");
    writeShutdown(copilotHome, "sess-1", 7);
    const stdout = [message("ok"), resultLine("sess-1")].join("\n");
    const { result, calls } = await copilot(stdout, { COPILOT_HOME: copilotHome });

    expect(calls[0].options.cwd).toBeUndefined();
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 2 });
  });

  test("a missing session file leaves usage to stdout", async () => {
    const stdout = [message("ok"), resultLine("sess-2")].join("\n");
    const { result } = await copilot(stdout, {
      COPILOT_HOME: resolve(home.home, "nowhere"),
    });

    expect(result.usage).toBeUndefined();
  });

  test("a token login runs from a throwaway COPILOT_HOME", async () => {
    const { result, calls } = await copilot(message("ok"), { GH_TOKEN: "gh" });
    const cwd = String(calls[0].options.cwd);

    expect(result.output).toBe("ok");
    expect(basename(cwd)).toStartWith("pal-copilot-");
    expect(envOf(calls[0]).COPILOT_HOME).toBe(cwd);
    expect(existsSync(cwd)).toBe(false);
  });
});
