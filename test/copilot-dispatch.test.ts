import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { eventsSince } from "../src/hooks/lib/events";
import { buildCliPrompt, buildCopilotArgs, inference } from "../src/hooks/lib/inference";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { copilotReplying, prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const COPILOT_TOKEN_ENV = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_HOME",
  "PAL_INFERENCE_DISABLED",
  "PATH",
  "CLAUDECODE",
  "COPILOT_HOME",
  ...COPILOT_TOKEN_ENV,
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
  test("omits -p so the prompt can arrive on stdin", () => {
    // -p/--prompt only takes the prompt inline, and a multi-paragraph argv
    // element cannot survive cmd.exe when Bun.spawn resolves copilot to its
    // Windows .cmd shim. Piping stdin keeps copilot non-interactive anyway.
    const args = buildCopilotArgs({ user: "hi" });
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--prompt");
  });

  test("includes the recursion-defense + safety flags", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args).toContain("--no-custom-instructions");
    expect(args).toContain("--disable-builtin-mcps");
    expect(args).toContain("--no-auto-update");
    expect(args).toContain("--no-color");
  });

  // With every tool allowed, an inference child loaded the entities skill and
  // wrote contacts into the real knowledge store instead of answering.
  test("the child can see no tool and may not run a shell, write a file or open a URL", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args).toContain("--available-tools=none");
    expect(args).toEqual(
      expect.arrayContaining([
        "--deny-tool=shell",
        "--deny-tool=write",
        "--deny-tool=url",
      ])
    );
    expect(args).not.toContain("--allow-all-tools");
  });

  test("prints only the reply, without tool notices or usage stats", () => {
    expect(buildCopilotArgs({ user: "hi" })).toContain("--silent");
  });

  test("prints JSON events, so the reply and its usage can be read apart", () => {
    const args = buildCopilotArgs({ user: "hi" });
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
  });

  test("no argv element carries the prompt or a newline", () => {
    const args = buildCopilotArgs({ system: "Be terse", user: "summarize this" });
    expect(args).not.toContain("summarize this");
    expect(args.filter((a) => a.includes("\n"))).toEqual([]);
  });

  test("system + user are concatenated into the stdin prompt", () => {
    const prompt = buildCliPrompt({ system: "Be terse", user: "ping" });
    expect(prompt).toContain("Be terse");
    expect(prompt).toContain("ping");
    expect(prompt.indexOf("Be terse")).toBeLessThan(prompt.indexOf("ping"));
  });

  test("jsonSchema instruction appended to the stdin prompt", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    const prompt = buildCliPrompt({ user: "rate this", jsonSchema: schema });
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
  const saved = savedEnv();
  let tmpBin: string;

  beforeEach(() => {
    restoreEnv(saved);
    tmpBin = freshTestDir(import.meta.file);
    process.env.PAL_HOME = tmpBin;
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    for (const name of COPILOT_TOKEN_ENV) delete process.env[name];
    process.env.COPILOT_HOME = "/users/own-copilot-home";
    process.env.PAL_AGENT = "copilot";
  });

  const reportsWhereItRan = () =>
    copilotReplying(
      "JSON.stringify({ home: process.env.COPILOT_HOME, cwd: process.cwd() })"
    );

  async function whereCopilotRan(): Promise<{ home: string; cwd: string }> {
    writeFakeBin(tmpBin, "copilot", reportsWhereItRan());
    prependPath(tmpBin);
    const result = await inference({ user: "hi", timeout: 5000 });
    return JSON.parse(result.output ?? "{}");
  }

  test.each(COPILOT_TOKEN_ENV)("with %s, PAL's instructions stay out", async (name) => {
    process.env[name] = "set";
    const seen = await whereCopilotRan();
    expect(basename(seen.cwd)).toBe(basename(seen.home));
    expect(basename(seen.home)).toStartWith("pal-copilot-");
    expect(seen.cwd).not.toBe(process.cwd());
    expect(existsSync(seen.home)).toBe(false);
  });

  test("a token in PAL's .env counts too", async () => {
    writeFileSync(resolve(tmpBin, ".env"), "GH_TOKEN=set\n");
    expect((await whereCopilotRan()).home).not.toBe("/users/own-copilot-home");
  });

  test("without a token copilot keeps its own home, where its /login account lives", async () => {
    process.env.GITHUB_TOKEN = "";
    expect(await whereCopilotRan()).toEqual({
      home: "/users/own-copilot-home",
      cwd: process.cwd(),
    });
  });

  test("end-to-end: fake copilot echoes stdin, dispatcher captures it", async () => {
    // Reads stdin rather than argv: that is where the prompt now travels.
    writeFakeBin(tmpBin, "copilot", copilotReplying("await Bun.stdin.text()"));
    prependPath(tmpBin);

    const result = await inference({ user: "hello-copilot", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello-copilot");
  });

  test("fake copilot sees PAL_SPAWNED_INFERENCE=1 and CLAUDECODE unset", async () => {
    writeFakeBin(
      tmpBin,
      "copilot",
      copilotReplying(
        `\`sentinel=\${process.env.${SPAWN_GUARD_ENV.SENTINEL}} claudecode=[\${process.env.CLAUDECODE ?? ""}]\``
      )
    );
    prependPath(tmpBin);
    process.env.CLAUDECODE = "1";

    const result = await inference({ user: "ignored", timeout: 5000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("sentinel=1 claudecode=[]");
    expect(process.env.CLAUDECODE).toBe("1");
  });

  test("the call is logged with the prompt tokens copilot reported, output left unknown", async () => {
    writeFakeBin(
      tmpBin,
      "copilot",
      copilotReplying(`"pong"`, { prompt_tokens: 4289, cache_read: 1, cache_write: 4286 })
    );
    prependPath(tmpBin);

    await inference({ user: "hi", timeout: 5000 });
    expect(eventsSince("inference_call", new Date(0))[0]).toMatchObject({
      route: "copilot-spawn",
      inputTokens: 2,
      cacheRead: 1,
      cacheWrite5m: 4286,
      outputTokens: null,
    });
  });

  test("the reply is copilot's last message, not its first", async () => {
    writeFakeBin(
      tmpBin,
      "copilot",
      `console.log(JSON.stringify({ type: "assistant.message", data: { content: "draft" } }));\n${copilotReplying(`"final"`)}`
    );
    prependPath(tmpBin);

    expect((await inference({ user: "hi", timeout: 5000 })).output).toBe("final");
  });

  test("non-zero exit from fake copilot returns success: false", async () => {
    writeFakeBin(tmpBin, "copilot", `process.exit(1);\n`);
    prependPath(tmpBin);

    const result = await inference({ user: "hi", timeout: 5000 });
    expect(result.success).toBe(false);
  });

  test("JSON-schema path parses fake copilot JSON output", async () => {
    writeFakeBin(tmpBin, "copilot", copilotReplying(`'{"verdict":"ok"}'`));
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
