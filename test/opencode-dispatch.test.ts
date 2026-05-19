import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _resetOpencodeBinaryCache,
  buildOpencodeArgs,
  extractOpencodeText,
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

describe("buildOpencodeArgs", () => {
  test("includes run + --pure (recursion defense) every time", () => {
    const args = buildOpencodeArgs({ user: "hi" });
    expect(args[0]).toBe("run");
    expect(args).toContain("--pure");
  });

  test("user prompt is the last positional argument", () => {
    const args = buildOpencodeArgs({ user: "summarize this" });
    expect(args[args.length - 1]).toBe("summarize this");
  });

  test("system + user are concatenated into the positional prompt", () => {
    const args = buildOpencodeArgs({ system: "Be terse", user: "ping" });
    const prompt = args[args.length - 1];
    expect(prompt).toContain("Be terse");
    expect(prompt).toContain("ping");
    expect(prompt.indexOf("Be terse")).toBeLessThan(prompt.indexOf("ping"));
  });

  test("jsonSchema instruction is appended to the prompt", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const args = buildOpencodeArgs({ user: "rate this", jsonSchema: schema });
    const prompt = args[args.length - 1];
    expect(prompt).toContain('"type":"object"');
    expect(prompt.toLowerCase()).toContain("json");
  });

  test("uses --format json so stdout can be parsed deterministically", () => {
    const args = buildOpencodeArgs({ user: "hi" });
    const fmtIdx = args.indexOf("--format");
    expect(args[fmtIdx + 1]).toBe("json");
  });

  test("never includes claude-specific or codex-specific flags", () => {
    const args = buildOpencodeArgs({ user: "hi" });
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--setting-sources");
    expect(args).not.toContain("exec");
    expect(args).not.toContain("--ignore-user-config");
  });
});

describe("extractOpencodeText", () => {
  test("extracts text from NDJSON events", () => {
    const raw = [
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: "Hello " } }),
      JSON.stringify({ type: "text", part: { type: "text", text: "world." } }),
      JSON.stringify({ type: "step_finish", part: { type: "step-finish" } }),
    ].join("\n");
    expect(extractOpencodeText(raw)).toBe("Hello world.");
  });

  test("ignores non-JSON lines (opencode banner etc)", () => {
    const raw = `> build · provider/model
${JSON.stringify({ type: "text", part: { type: "text", text: "OK" } })}`;
    expect(extractOpencodeText(raw)).toBe("OK");
  });

  test("returns empty string on no text events", () => {
    const raw = JSON.stringify({ type: "step_start", part: { type: "step-start" } });
    expect(extractOpencodeText(raw)).toBe("");
  });
});

describe("inference dispatcher — opencode spawn integration (fake binary)", () => {
  let saved: Record<string, string | undefined>;
  let tmpBin: string;

  beforeEach(() => {
    saved = savedEnv();
    tmpBin = mkdtempSync(resolve(tmpdir(), "pal-fake-opencode-"));
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "opencode";
    _resetOpencodeBinaryCache();
  });

  afterEach(() => {
    rmSync(tmpBin, { recursive: true, force: true });
    restoreEnv(saved);
    _resetOpencodeBinaryCache();
  });

  test("end-to-end: fake opencode emits a text event, dispatcher extracts it", async () => {
    const event = JSON.stringify({
      type: "text",
      part: { type: "text", text: "hello-opencode" },
    });
    writeFakeBin(tmpBin, "opencode", `console.log(${JSON.stringify(event)});\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "anything", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello-opencode");
  });

  test("fake opencode sees PAL_SPAWNED_INFERENCE=1 and CLAUDECODE unset", async () => {
    writeFakeBin(
      tmpBin,
      "opencode",
      `const text = \`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} claudecode=[\${process.env.CLAUDECODE ?? ""}]\`;
console.log(JSON.stringify({ type: "text", part: { type: "text", text } }));\n`
    );
    prependPath(tmpBin);
    process.env.CLAUDECODE = "1";

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("non-zero exit from fake opencode returns success: false", async () => {
    writeFakeBin(tmpBin, "opencode", `process.exit(1);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("JSON-schema path parses opencode text event containing JSON", async () => {
    const event = JSON.stringify({
      type: "text",
      part: { type: "text", text: '{"verdict":"ok"}' },
    });
    writeFakeBin(tmpBin, "opencode", `console.log(${JSON.stringify(event)});\n`);
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
