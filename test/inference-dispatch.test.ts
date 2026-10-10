import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildClaudeArgs,
  buildCodexArgs,
  buildCopilotArgs,
  buildCursorArgs,
  buildOpencodeArgs,
  canInfer,
  hasApiKey,
  inference,
  injectJsonSchemaInstruction,
  loggedClaudeAuthMode,
  parseJsonFromOutput,
  schemaInstruction,
} from "../src/hooks/lib/inference";
import { logPromptSnapshot, recentHookErrors } from "../src/hooks/lib/log";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_HOME",
  "PAL_INFERENCE_DISABLED",
  "PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  SPAWN_GUARD_ENV.SENTINEL,
  SPAWN_GUARD_ENV.DEPTH,
] as const;

function savedEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of PRESERVED) saved[k] = process.env[k];
  return saved;
}
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of PRESERVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

const BASELINE = savedEnv();

describe("buildClaudeArgs", () => {
  test("includes core flags every time", () => {
    const args = buildClaudeArgs({ user: "hi" });
    expect(args).toContain("--print");
    expect(args).toContain("--tools");
    // "" must immediately follow --tools and --setting-sources
    const toolsIdx = args.indexOf("--tools");
    expect(args[toolsIdx + 1]).toBe("");
    const ssIdx = args.indexOf("--setting-sources");
    expect(args[ssIdx + 1]).toBe("");
    expect(args).toContain("--output-format");
    const ofIdx = args.indexOf("--output-format");
    expect(args[ofIdx + 1]).toBe("text");
  });

  // The system text goes to a file and only the path rides in argv, so a
  // multi-paragraph system prompt survives cmd.exe on Windows.
  test("points --system-prompt-file at the given path", () => {
    const args = buildClaudeArgs({ user: "hi" }, "/tmp/pal/system-prompt.md");
    const idx = args.indexOf("--system-prompt-file");
    expect(args[idx + 1]).toBe("/tmp/pal/system-prompt.md");
  });

  test("never passes the system text inline", () => {
    const args = buildClaudeArgs({ user: "hi", system: "be helpful" }, "/tmp/s.md");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("be helpful");
  });

  test("omits the system flag entirely when no file is given", () => {
    const args = buildClaudeArgs({ user: "hi" });
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--system-prompt-file");
  });

  test("the schema instruction is what lands in that file", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    expect(injectJsonSchemaInstruction("", schema)).toContain("'type':'object'");
  });

  test("never includes --bare (PAI billing trap)", () => {
    expect(buildClaudeArgs({ user: "hi" })).not.toContain("--bare");
  });
});

describe("injectJsonSchemaInstruction", () => {
  test("appends schema when system prompt exists", () => {
    const result = injectJsonSchemaInstruction("be helpful", { type: "object" });
    expect(result).toStartWith("be helpful");
    expect(result).toContain("{'type':'object'}");
  });

  test("returns just the schema instruction when system prompt empty", () => {
    const result = injectJsonSchemaInstruction("", { type: "object" });
    expect(result).toContain("{'type':'object'}");
  });
});

describe("parseJsonFromOutput", () => {
  test("extracts a plain JSON object", () => {
    expect(parseJsonFromOutput('{"a":1}')).toEqual({ a: 1 });
  });

  test("extracts JSON wrapped in prose", () => {
    expect(parseJsonFromOutput('Here you go: {"a":2} done.')).toEqual({ a: 2 });
  });

  test("extracts JSON array", () => {
    expect(parseJsonFromOutput("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("returns null on no JSON", () => {
    expect(parseJsonFromOutput("just prose")).toBeNull();
  });

  test("returns null on malformed JSON", () => {
    expect(parseJsonFromOutput("{not json")).toBeNull();
  });
});

describe("canInfer routing", () => {
  beforeEach(() => {
    restoreEnv(BASELINE);
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
  });

  test("hasApiKey reflects PAL_ANTHROPIC_API_KEY presence", () => {
    expect(hasApiKey()).toBe(false);
    process.env.PAL_ANTHROPIC_API_KEY = "sk-test";
    expect(hasApiKey()).toBe(true);
  });

  test("canInfer is true when API key set (any active agent)", () => {
    process.env.PAL_ANTHROPIC_API_KEY = "sk-test";
    expect(canInfer()).toBe(true);
  });
});

describe("inference dispatcher — depth limit refusal", () => {
  beforeEach(() => {
    restoreEnv(BASELINE);
    delete process.env.PAL_INFERENCE_DISABLED;
  });

  test("returns failure when depth >= MAX_DEPTH (no spawn, no API call)", async () => {
    process.env[SPAWN_GUARD_ENV.DEPTH] = String(SPAWN_GUARD_ENV.MAX_DEPTH);
    process.env.PAL_AGENT = "claude";
    process.env.PAL_ANTHROPIC_API_KEY = "sk-test"; // would otherwise work
    const result = await inference({ user: "hello", timeout: 100 });
    expect(result.success).toBe(false);
  });
});

describe("inference dispatcher — PAL_INFERENCE_DISABLED kill-switch", () => {
  test("inference() returns failure immediately when PAL_INFERENCE_DISABLED=1", async () => {
    const saved = process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_INFERENCE_DISABLED = "1";
    try {
      const start = Date.now();
      const result = await inference({ user: "hi", timeout: 30000 });
      const elapsed = Date.now() - start;
      expect(result.success).toBe(false);
      expect(elapsed).toBeLessThan(50); // no spawn, no fetch
    } finally {
      if (saved === undefined) delete process.env.PAL_INFERENCE_DISABLED;
      else process.env.PAL_INFERENCE_DISABLED = saved;
    }
  });
});

describe("inference dispatcher — claude spawn integration (fake binary)", () => {
  let tmpBin: string;

  beforeEach(() => {
    restoreEnv(BASELINE);
    delete process.env.PAL_INFERENCE_DISABLED;
    tmpBin = freshTestDir(import.meta.file);
    // Isolate debug-log writes from production ~/.pal/ — inference() will
    // log into tmpBin/memory/state/debug.log instead.
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    process.env.PAL_AGENT = "claude";
  });

  test("end-to-end: fake claude binary echoes stdin, dispatcher returns it", async () => {
    // Fake claude: echoes stdin to stdout, exits 0.
    writeFakeBin(
      tmpBin,
      "claude",
      `for await (const c of Bun.stdin.stream()) Bun.write(Bun.stdout, c);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "hello from PAL", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello from PAL");
  });

  test("fake claude binary sees PAL_SPAWNED_INFERENCE=1 in its env", async () => {
    writeFakeBin(
      tmpBin,
      "claude",
      `console.log(\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} depth=\${process.env.${SPAWN_GUARD_ENV.DEPTH}}\`);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 depth=1");
  });

  test("fake claude binary sees CLAUDECODE unset even when parent has it", async () => {
    // Parent env has CLAUDECODE="1" (as it would inside a real Claude Code session).
    // The child claude --print must see it absent so its nested-session guard
    // doesn't fire.
    process.env.CLAUDECODE = "1";
    writeFakeBin(
      tmpBin,
      "claude",
      `console.log(\`claudecode=[\${process.env.CLAUDECODE ?? ""}]\`);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("claudecode=[]");
    // Parent still has CLAUDECODE=1 — scoping confirmed.
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("fake claude receives CLAUDE_CODE_OAUTH_TOKEN from ~/.pal/.env", async () => {
    writeFileSync(resolve(tmpBin, ".env"), "CLAUDE_CODE_OAUTH_TOKEN=from-pal-env\n");
    writeFakeBin(
      tmpBin,
      "claude",
      `console.log(\`token=[\${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""}]\`);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.output).toBe("token=[from-pal-env]");
  });

  test.each([
    [
      "a subscription token drops them",
      "CLAUDE_CODE_OAUTH_TOKEN=from-pal-env\n",
      "key=[] auth=[]",
    ],
    [
      "without a token claude keeps them, so key-only and gateway logins work",
      "",
      "key=[api-key-login] auth=[gateway-login]",
    ],
  ])("API keys outranking the token: %s", async (_case, tokenLine, expected) => {
    process.env.ANTHROPIC_API_KEY = "api-key-login";
    writeFileSync(
      resolve(tmpBin, ".env"),
      `${tokenLine}ANTHROPIC_AUTH_TOKEN=gateway-login\n`
    );
    writeFakeBin(
      tmpBin,
      "claude",
      `console.log(\`key=[\${process.env.ANTHROPIC_API_KEY ?? ""}] auth=[\${process.env.ANTHROPIC_AUTH_TOKEN ?? ""}]\`);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.output).toBe(expected);
  });

  test.each([
    ["token" as const, "CLAUDE_CODE_OAUTH_TOKEN=from-pal-env\n"],
    ["native" as const, ""],
  ])("a failed claude spawn logs which login it used: %s", async (mode, palEnv) => {
    writeFileSync(resolve(tmpBin, ".env"), palEnv);
    writeFakeBin(
      tmpBin,
      "claude",
      `console.error("Failed to authenticate: OAuth session expired");\nprocess.exit(1);\n`
    );
    prependPath(tmpBin);

    await inference({ user: "ignored", timeout: 5000 });
    const [group] = recentHookErrors();
    expect(loggedClaudeAuthMode(group.lastMessage ?? "")).toBe(mode);
    expect(group.lastMessage).not.toContain("from-pal-env");
  });

  test("PAL_ANTHROPIC_API_KEY in ~/.pal/.env counts as an API fallback", () => {
    expect(hasApiKey()).toBe(false);
    writeFileSync(resolve(tmpBin, ".env"), "PAL_ANTHROPIC_API_KEY=from-pal-env\n");
    expect(hasApiKey()).toBe(true);
  });

  test("logDebug emits route=claude-spawn line when debug enabled", async () => {
    writeFakeBin(tmpBin, "claude", `console.log("hello");\n`);
    prependPath(tmpBin);

    const palHomeSaved = process.env.PAL_HOME;
    const tmpHome = freshTestDir(import.meta.file);
    const stateDir = resolve(tmpHome, "memory", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(resolve(stateDir, "debug-enabled"), "");
    process.env.PAL_HOME = tmpHome;

    try {
      const result = await inference({ user: "ping", timeout: 5000 });
      expect(result.success).toBe(true);
      const logPath = resolve(tmpHome, "debug", "debug.log");
      const log = readFileSync(logPath, "utf-8");
      expect(log).toContain("route=claude-spawn");
      expect(log).toContain("done binary=claude success=true");
    } finally {
      if (palHomeSaved === undefined) delete process.env.PAL_HOME;
      else process.env.PAL_HOME = palHomeSaved;
      removeOnceReleased(tmpHome);
    }
  });

  test("non-zero exit from fake claude returns success: false", async () => {
    writeFakeBin(tmpBin, "claude", `process.exit(2);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("a failed spawn carries the first line of its error", async () => {
    writeFakeBin(
      tmpBin,
      "claude",
      `console.error("\\nModel unavailable on this plan\\nat line 2");\nprocess.exit(1);\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.error).toBe("Model unavailable on this plan");
  });

  test("JSON-schema path parses fake claude's JSON output", async () => {
    writeFakeBin(tmpBin, "claude", `console.log('{"verdict":"good"}');\n`);
    prependPath(tmpBin);

    const result = await inference({
      user: "rate this",
      jsonSchema: { type: "object", properties: { verdict: { type: "string" } } },
      timeout: 5000,
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output ?? "{}")).toEqual({ verdict: "good" });
  });

  test("a JSON reply that breaks the schema fails and names the field", async () => {
    writeFakeBin(tmpBin, "claude", `console.log('{"verdict":7,"extra":true}');\n`);
    prependPath(tmpBin);

    const result = await inference({
      user: "rate this",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["verdict"],
        properties: { verdict: { type: "string" } },
      },
      timeout: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("verdict");
    expect(result.error).toContain("extra");
  });
});

describe("logPromptSnapshot", () => {
  test("writes last-prompt.md to debug folder when debug enabled", () => {
    const tmpHome = freshTestDir(import.meta.file);
    const stateDir = resolve(tmpHome, "memory", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(resolve(stateDir, "debug-enabled"), "");
    const palHomeSaved = process.env.PAL_HOME;
    process.env.PAL_HOME = tmpHome;
    try {
      logPromptSnapshot("hello world", null);
      const out = readFileSync(resolve(tmpHome, "debug", "last-prompt.md"), "utf-8");
      expect(out).toBe("## Prompt\n\nhello world");
    } finally {
      if (palHomeSaved === undefined) delete process.env.PAL_HOME;
      else process.env.PAL_HOME = palHomeSaved;
      removeOnceReleased(tmpHome);
    }
  });

  test("does not write when debug disabled", () => {
    const tmpHome = freshTestDir(import.meta.file);
    const palHomeSaved = process.env.PAL_HOME;
    process.env.PAL_HOME = tmpHome;
    try {
      logPromptSnapshot("should not appear", null);
      const exists = Bun.file(resolve(tmpHome, "debug", "last-prompt.md")).size;
      expect(exists).toBe(0);
    } finally {
      if (palHomeSaved === undefined) delete process.env.PAL_HOME;
      else process.env.PAL_HOME = palHomeSaved;
      removeOnceReleased(tmpHome);
    }
  });
});

describe("web research", () => {
  const web = { user: "find it", web: true };

  test("claude sees and may use web search and fetch, and no other tool", () => {
    const args = buildClaudeArgs(web);
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--allowed-tools") + 1]).toBe("WebSearch,WebFetch");
    expect(buildClaudeArgs({ user: "hi" })).not.toContain("--allowed-tools");
  });

  test("codex turns on live search and stays in its read-only sandbox", () => {
    const args = buildCodexArgs(web);
    expect(args[args.indexOf("-c") + 1]).toBe("web_search=live");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(buildCodexArgs({ user: "hi" })).not.toContain("web_search=live");
  });

  test("copilot may only fetch web pages, and still not run a shell or write", () => {
    const args = buildCopilotArgs(web);
    expect(args).toEqual(
      expect.arrayContaining([
        "--available-tools=web_fetch",
        "--allow-tool=web_fetch",
        "--allow-all-urls",
        "--deny-tool=shell",
        "--deny-tool=write",
      ])
    );
    expect(args).not.toContain("--available-tools=none");
    expect(args).not.toContain("--deny-tool=url");
  });

  test("an agent without a web route says so instead of answering from memory", async () => {
    restoreEnv(BASELINE);
    delete process.env.PAL_INFERENCE_DISABLED;
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    const tmpBin = freshTestDir(import.meta.file);
    process.env.PAL_HOME = tmpBin;
    process.env.PAL_AGENT = "opencode";
    writeFakeBin(tmpBin, "opencode", `console.log("from memory");\n`);
    prependPath(tmpBin);

    const result = await inference({ ...web, timeout: 5000 });
    expect(result).toEqual({
      success: false,
      error: "web research is not available on opencode yet",
    });
  });

  for (const [name, build] of [
    ["claude", buildClaudeArgs],
    ["codex", buildCodexArgs],
    ["copilot", buildCopilotArgs],
  ] as const) {
    test(`${name} web argv carries no double quote`, () => {
      expect(build(web).filter((arg) => arg.includes('"'))).toEqual([]);
    });
  }
});

describe("schema instruction stays free of double quotes", () => {
  const schema = { type: "object", properties: { verdict: { type: "string" } } };
  const opts = { user: "rate this", jsonSchema: schema };
  const builders: Array<[string, (o: typeof opts) => string[]]> = [
    ["claude", buildClaudeArgs],
    ["codex", buildCodexArgs],
    ["opencode", buildOpencodeArgs],
    ["copilot", buildCopilotArgs],
    ["cursor", buildCursorArgs],
  ];

  // A double quote in an argv element does not survive cmd.exe when Bun.spawn
  // resolves an agent CLI to its Windows .cmd shim: the child exits non-zero
  // with no output. Keeping argv quote-free is what makes these paths work on
  // Windows, so assert it per agent rather than trusting the shared helper.
  for (const [name, build] of builders) {
    test(`${name} argv carries no double quote`, () => {
      expect(build(opts).filter((arg) => arg.includes('"'))).toEqual([]);
    });
  }

  test("the schema shape still reaches the model", () => {
    const line = schemaInstruction(schema);
    expect(line).toContain("verdict");
    expect(line).toContain("object");
    expect(line).not.toContain('"');
  });
});
