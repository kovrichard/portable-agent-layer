import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _resetCodexBinaryCache,
  buildCodexArgs,
  hasOpenAiKey,
  inference,
} from "../src/hooks/lib/inference";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_HOME",
  "PAL_INFERENCE_DISABLED",
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

describe("buildCodexArgs", () => {
  test("includes the codex exec flags every time", () => {
    const args = buildCodexArgs({ user: "hi" });
    expect(args[0]).toBe("exec");
    const colorIdx = args.indexOf("--color");
    expect(args[colorIdx + 1]).toBe("never");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--ephemeral");
    const sandboxIdx = args.indexOf("--sandbox");
    expect(args[sandboxIdx + 1]).toBe("read-only");
  });

  test("does NOT pass the nonexistent --ask-for-approval flag", () => {
    expect(buildCodexArgs({ user: "hi" })).not.toContain("--ask-for-approval");
  });

  test("user prompt is the last positional argument", () => {
    const args = buildCodexArgs({ user: "summarize this" });
    expect(args[args.length - 1]).toBe("summarize this");
  });

  test("system + user are concatenated into the positional prompt", () => {
    const args = buildCodexArgs({ system: "Be terse", user: "ping" });
    const prompt = args[args.length - 1];
    expect(prompt).toContain("Be terse");
    expect(prompt).toContain("ping");
    expect(prompt.indexOf("Be terse")).toBeLessThan(prompt.indexOf("ping"));
  });

  test("jsonSchema instruction is appended to the prompt", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const args = buildCodexArgs({ user: "rate this", jsonSchema: schema });
    const prompt = args[args.length - 1];
    expect(prompt).toContain("'type':'object'");
    expect(prompt.toLowerCase()).toContain("json");
  });

  test("never includes claude-specific flags", () => {
    const args = buildCodexArgs({ user: "hi" });
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--setting-sources");
  });
});

describe("hasOpenAiKey", () => {
  test("false when PAL_OPENAI_API_KEY is not set", () => {
    const saved = process.env.PAL_OPENAI_API_KEY;
    delete process.env.PAL_OPENAI_API_KEY;
    try {
      expect(hasOpenAiKey()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.PAL_OPENAI_API_KEY = saved;
    }
  });

  test("true when PAL_OPENAI_API_KEY is set", () => {
    const saved = process.env.PAL_OPENAI_API_KEY;
    process.env.PAL_OPENAI_API_KEY = "sk-test";
    try {
      expect(hasOpenAiKey()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PAL_OPENAI_API_KEY;
      else process.env.PAL_OPENAI_API_KEY = saved;
    }
  });
});

describe("inference dispatcher — codex spawn integration (fake binary)", () => {
  let saved: Record<string, string | undefined>;
  let tmpBin: string;

  beforeEach(() => {
    saved = savedEnv();
    tmpBin = mkdtempSync(resolve(tmpdir(), "pal-fake-codex-"));
    // Isolate debug-log writes from production ~/.pal/.
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "codex";
    _resetCodexBinaryCache();
  });

  afterEach(() => {
    rmSync(tmpBin, { recursive: true, force: true });
    restoreEnv(saved);
    _resetCodexBinaryCache();
  });

  test("end-to-end: fake codex prints argv-tail (the prompt), dispatcher captures it", async () => {
    writeFakeBin(tmpBin, "codex", `console.log(Bun.argv[Bun.argv.length - 1]);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hello-codex", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello-codex");
  });

  test("fake codex sees PAL_SPAWNED_INFERENCE=1 and CLAUDECODE unset in its env", async () => {
    writeFakeBin(
      tmpBin,
      "codex",
      `console.log(\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} claudecode=[\${process.env.CLAUDECODE ?? ""}]\`);\n`
    );
    prependPath(tmpBin);
    process.env.CLAUDECODE = "1"; // parent has it set

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1"); // parent untouched
  });

  test("non-zero exit from fake codex returns success: false", async () => {
    writeFakeBin(tmpBin, "codex", `process.exit(2);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("JSON-schema path parses fake codex JSON output", async () => {
    writeFakeBin(tmpBin, "codex", `console.log('{"verdict":"ok"}');\n`);
    prependPath(tmpBin);

    const result = await inference({
      user: "rate",
      jsonSchema: { type: "object", properties: { verdict: { type: "string" } } },
      timeout: 5000,
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output ?? "{}")).toEqual({ verdict: "ok" });
  });
});
