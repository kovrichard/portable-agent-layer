import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../src/hooks/lib/events";
import { hasApiKey, inference, loggedClaudeAuthMode } from "../src/hooks/lib/inference";
import { recentHookErrors } from "../src/hooks/lib/log";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { claudeReplying, prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { restoreEnv, savedEnv } from "./lib/inference-dispatch-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const BASELINE = savedEnv();

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
    writeFakeBin(tmpBin, "claude", claudeReplying("await Bun.stdin.text()"));
    prependPath(tmpBin);

    const result = await inference({ user: "hello from PAL", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello from PAL");
  });

  test("the call is logged with the tokens claude reported", async () => {
    writeFakeBin(
      tmpBin,
      "claude",
      claudeReplying(`"hi"`, {
        input_tokens: 9,
        output_tokens: 51,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 6576,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 6576 },
        output_tokens_details: { thinking_tokens: 32 },
      })
    );
    prependPath(tmpBin);

    await inference({ user: "hi", caller: "rating", timeout: 5000 });
    const [call] = eventsSince("inference_call", new Date(0));
    expect(call).toMatchObject({
      route: "claude-spawn",
      inputTokens: 9,
      outputTokens: 51,
      cacheWrite5m: 0,
      cacheWrite1h: 6576,
      cacheRead: 0,
      thinkingTokens: 32,
    });
  });

  test("the caller learns the model the call was logged under", async () => {
    writeFakeBin(tmpBin, "claude", claudeReplying(`"hi"`));
    prependPath(tmpBin);

    const result = await inference({ user: "hi", caller: "rating", timeout: 5000 });
    const [call] = eventsSince("inference_call", new Date(0));
    expect(result.model).toEqual(expect.any(String));
    expect(call.model).toBe(result.model);
  });

  test("a reply claude marks as an error is not taken as the answer", async () => {
    writeFakeBin(
      tmpBin,
      "claude",
      `console.log(JSON.stringify({ type: "result", is_error: true, result: "Prompt is too long" }));\n`
    );
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("fake claude binary sees PAL_SPAWNED_INFERENCE=1 in its env", async () => {
    writeFakeBin(
      tmpBin,
      "claude",
      claudeReplying(
        `\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} depth=\${process.env.${SPAWN_GUARD_ENV.DEPTH}}\``
      )
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
      claudeReplying(`\`claudecode=[\${process.env.CLAUDECODE ?? ""}]\``)
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
      claudeReplying(`\`token=[\${process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ""}]\``)
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
      claudeReplying(
        `\`key=[\${process.env.ANTHROPIC_API_KEY ?? ""}] auth=[\${process.env.ANTHROPIC_AUTH_TOKEN ?? ""}]\``
      )
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
    writeFakeBin(tmpBin, "claude", claudeReplying(`"hello"`));
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
    writeFakeBin(tmpBin, "claude", claudeReplying(`'{"verdict":"good"}'`));
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
    writeFakeBin(tmpBin, "claude", claudeReplying(`'{"verdict":7,"extra":true}'`));
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
