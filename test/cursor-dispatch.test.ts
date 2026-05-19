import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _resetCursorBinaryCache,
  buildCursorArgs,
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
  "CURSOR_API_KEY",
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

describe("buildCursorArgs", () => {
  test("uses -p for non-interactive print mode", () => {
    const args = buildCursorArgs({ user: "hi" });
    expect(args[0]).toBe("-p");
  });

  test("includes --mode ask (read-only recursion defense)", () => {
    const args = buildCursorArgs({ user: "hi" });
    const idx = args.indexOf("--mode");
    expect(args[idx + 1]).toBe("ask");
  });

  test("includes --output-format text for clean stdout", () => {
    const args = buildCursorArgs({ user: "hi" });
    const idx = args.indexOf("--output-format");
    expect(args[idx + 1]).toBe("text");
  });

  test("includes --trust (required for headless mode)", () => {
    expect(buildCursorArgs({ user: "hi" })).toContain("--trust");
  });

  test("prompt is the last positional argument", () => {
    const args = buildCursorArgs({ user: "summarize this" });
    expect(args[args.length - 1]).toBe("summarize this");
  });

  test("system + user are concatenated into the positional prompt", () => {
    const args = buildCursorArgs({ system: "Be terse", user: "ping" });
    const prompt = args[args.length - 1];
    expect(prompt).toContain("Be terse");
    expect(prompt).toContain("ping");
    expect(prompt.indexOf("Be terse")).toBeLessThan(prompt.indexOf("ping"));
  });

  test("jsonSchema instruction appended to prompt", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const args = buildCursorArgs({ user: "rate this", jsonSchema: schema });
    const prompt = args[args.length - 1];
    expect(prompt).toContain('"type":"object"');
    expect(prompt.toLowerCase()).toContain("json");
  });

  test("never includes write-enabling flags", () => {
    // --force / --yolo / --mode plan would allow tool calls. We never want them.
    const args = buildCursorArgs({ user: "hi" });
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--plan");
  });
});

describe("inference dispatcher — cursor spawn integration (fake binary)", () => {
  let saved: Record<string, string | undefined>;
  let tmpBin: string;

  beforeEach(() => {
    saved = savedEnv();
    tmpBin = mkdtempSync(resolve(tmpdir(), "pal-fake-cursor-"));
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "cursor";
    _resetCursorBinaryCache();
  });

  afterEach(() => {
    rmSync(tmpBin, { recursive: true, force: true });
    restoreEnv(saved);
    _resetCursorBinaryCache();
  });

  test("end-to-end: fake cursor-agent echoes positional prompt, dispatcher captures it", async () => {
    writeFakeBin(tmpBin, "cursor-agent", `console.log(Bun.argv[Bun.argv.length - 1]);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hello-cursor", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello-cursor");
  });

  test("fake cursor-agent sees PAL_SPAWNED_INFERENCE=1 and CLAUDECODE unset", async () => {
    writeFakeBin(
      tmpBin,
      "cursor-agent",
      `console.log(\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} claudecode=[\${process.env.CLAUDECODE ?? ""}]\`);\n`
    );
    prependPath(tmpBin);
    process.env.CLAUDECODE = "1";

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("non-zero exit returns success: false", async () => {
    writeFakeBin(tmpBin, "cursor-agent", `process.exit(1);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("JSON-schema path parses fake cursor JSON output", async () => {
    writeFakeBin(tmpBin, "cursor-agent", `console.log('{"verdict":"ok"}');\n`);
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
