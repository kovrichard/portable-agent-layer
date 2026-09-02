import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _resetClaudeBinaryCache,
  buildClaudeArgs,
  buildCodexArgs,
  buildCopilotArgs,
  buildCursorArgs,
  buildOpencodeArgs,
  canInfer,
  hasApiKey,
  inference,
  injectJsonSchemaInstruction,
  parseJsonFromOutput,
  schemaInstruction,
} from "../src/hooks/lib/inference";
import { logPromptSnapshot } from "../src/hooks/lib/log";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_HOME",
  "PATH",
  "CLAUDECODE",
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

  test("uses model from opts when provided", () => {
    const args = buildClaudeArgs({ user: "hi", model: "sonnet" });
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("sonnet");
  });

  test("adds --system-prompt when system provided", () => {
    const args = buildClaudeArgs({ user: "hi", system: "be helpful" });
    const idx = args.indexOf("--system-prompt");
    expect(args[idx + 1]).toBe("be helpful");
  });

  test("omits --system-prompt when neither system nor jsonSchema provided", () => {
    const args = buildClaudeArgs({ user: "hi" });
    expect(args).not.toContain("--system-prompt");
  });

  test("injects schema into system prompt when jsonSchema provided", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const args = buildClaudeArgs({ user: "hi", jsonSchema: schema });
    const idx = args.indexOf("--system-prompt");
    expect(args[idx + 1]).toContain("'type':'object'");
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
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = savedEnv();
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    _resetClaudeBinaryCache();
  });
  afterEach(() => {
    restoreEnv(saved);
    _resetClaudeBinaryCache();
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
  let saved: Record<string, string | undefined>;
  let savedDisabled: string | undefined;
  beforeEach(() => {
    saved = savedEnv();
    savedDisabled = process.env.PAL_INFERENCE_DISABLED;
    delete process.env.PAL_INFERENCE_DISABLED;
  });
  afterEach(() => {
    restoreEnv(saved);
    if (savedDisabled === undefined) delete process.env.PAL_INFERENCE_DISABLED;
    else process.env.PAL_INFERENCE_DISABLED = savedDisabled;
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
  let saved: Record<string, string | undefined>;
  let savedDisabled: string | undefined;
  let tmpBin: string;

  beforeEach(() => {
    saved = savedEnv();
    savedDisabled = process.env.PAL_INFERENCE_DISABLED;
    delete process.env.PAL_INFERENCE_DISABLED;
    tmpBin = mkdtempSync(resolve(tmpdir(), "pal-fake-claude-"));
    // Isolate debug-log writes from production ~/.pal/ — inference() will
    // log into tmpBin/memory/state/debug.log instead, cleaned up below.
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    process.env.PAL_AGENT = "claude";
    _resetClaudeBinaryCache();
  });

  afterEach(() => {
    rmSync(tmpBin, { recursive: true, force: true });
    restoreEnv(saved);
    if (savedDisabled === undefined) delete process.env.PAL_INFERENCE_DISABLED;
    else process.env.PAL_INFERENCE_DISABLED = savedDisabled;
    _resetClaudeBinaryCache();
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

  test("logDebug emits route=claude-spawn line when debug enabled", async () => {
    writeFakeBin(tmpBin, "claude", `console.log("hello");\n`);
    prependPath(tmpBin);

    const palHomeSaved = process.env.PAL_HOME;
    const tmpHome = mkdtempSync(resolve(tmpdir(), "pal-debug-home-"));
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
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("non-zero exit from fake claude returns success: false", async () => {
    writeFakeBin(tmpBin, "claude", `process.exit(2);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
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
});

describe("logPromptSnapshot", () => {
  test("writes last-prompt.md to debug folder when debug enabled", () => {
    const tmpHome = mkdtempSync(resolve(tmpdir(), "pal-prompt-snap-"));
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
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("does not write when debug disabled", () => {
    const tmpHome = mkdtempSync(resolve(tmpdir(), "pal-prompt-snap-nodebug-"));
    const palHomeSaved = process.env.PAL_HOME;
    process.env.PAL_HOME = tmpHome;
    try {
      logPromptSnapshot("should not appear", null);
      const exists = Bun.file(resolve(tmpHome, "debug", "last-prompt.md")).size;
      expect(exists).toBe(0);
    } finally {
      if (palHomeSaved === undefined) delete process.env.PAL_HOME;
      else process.env.PAL_HOME = palHomeSaved;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
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
