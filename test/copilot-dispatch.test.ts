import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _resetCopilotBinaryCache,
  buildCopilotArgs,
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

describe("buildCopilotArgs", () => {
  test("uses -p for non-interactive prompt mode", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args[0]).toBe("-p");
  });

  test("includes the recursion-defense + safety flags", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args).toContain("--no-custom-instructions");
    expect(args).toContain("--disable-builtin-mcps");
    expect(args).toContain("--no-auto-update");
    expect(args).toContain("--no-color");
    expect(args).toContain("--allow-all-tools");
  });

  test("prompt is the argument after -p", () => {
    const args = buildCopilotArgs({ user: "summarize this" });
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe("summarize this");
  });

  test("system + user are concatenated", () => {
    const args = buildCopilotArgs({ system: "Be terse", user: "ping" });
    const pIdx = args.indexOf("-p");
    const prompt = args[pIdx + 1];
    expect(prompt).toContain("Be terse");
    expect(prompt).toContain("ping");
    expect(prompt.indexOf("Be terse")).toBeLessThan(prompt.indexOf("ping"));
  });

  test("jsonSchema instruction appended to prompt", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const args = buildCopilotArgs({ user: "rate this", jsonSchema: schema });
    const pIdx = args.indexOf("-p");
    const prompt = args[pIdx + 1];
    expect(prompt).toContain("'type':'object'");
    expect(prompt.toLowerCase()).toContain("json");
  });

  test("never includes flags from other agents", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--setting-sources");
    expect(args).not.toContain("--ignore-user-config");
    expect(args).not.toContain("--pure");
    expect(args).not.toContain("exec");
    expect(args).not.toContain("run");
  });
});

describe("inference dispatcher — copilot spawn integration (fake binary)", () => {
  let saved: Record<string, string | undefined>;
  let tmpBin: string;

  beforeEach(() => {
    saved = savedEnv();
    tmpBin = mkdtempSync(resolve(tmpdir(), "pal-fake-copilot-"));
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "copilot";
    _resetCopilotBinaryCache();
  });

  afterEach(() => {
    rmSync(tmpBin, { recursive: true, force: true });
    restoreEnv(saved);
    _resetCopilotBinaryCache();
  });

  test("end-to-end: fake copilot echoes prompt arg, dispatcher captures it", async () => {
    // Fake copilot reads argv[3] (the prompt passed after -p) and echoes it.
    // Bun.argv: [bun, script.ts, "-p", "<prompt>", ...]
    writeFakeBin(tmpBin, "copilot", `console.log(Bun.argv[3] ?? "");\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hello-copilot", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello-copilot");
  });

  test("fake copilot sees PAL_SPAWNED_INFERENCE=1 and CLAUDECODE unset", async () => {
    writeFakeBin(
      tmpBin,
      "copilot",
      `console.log(\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} claudecode=[\${process.env.CLAUDECODE ?? ""}]\`);\n`
    );
    prependPath(tmpBin);
    process.env.CLAUDECODE = "1";

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("non-zero exit from fake copilot returns success: false", async () => {
    writeFakeBin(tmpBin, "copilot", `process.exit(1);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("JSON-schema path parses fake copilot JSON output", async () => {
    writeFakeBin(tmpBin, "copilot", `console.log('{"verdict":"ok"}');\n`);
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
