import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractAntigravityText,
  INFERENCE_AGENT,
  streamJsonPrompt,
} from "../src/hooks/lib/antigravity-inference";
import { buildAntigravityArgs, inference } from "../src/hooks/lib/inference";
import { inferenceModel } from "../src/hooks/lib/models";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { freshTestDir } from "./lib/test-home";

const PRESERVED = [
  "PAL_AGENT",
  "PAL_ANTHROPIC_API_KEY",
  "PAL_GEMINI_DIR",
  "PAL_HOME",
  "PAL_INFERENCE_DISABLED",
  "PATH",
  SPAWN_GUARD_ENV.SENTINEL,
  SPAWN_GUARD_ENV.DEPTH,
] as const;

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function resultEvent(status: string, response: string): string {
  return JSON.stringify({ event: "result", result: { status, response } });
}

const SPAWNED = "11111111-2222-4333-8444-555555555555";
const USERS_OWN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function seedConversation(cliDir: string, id: string): string[] {
  const brain = resolve(cliDir, "brain", id);
  mkdirSync(resolve(brain, ".system_generated"), { recursive: true });
  const files = [
    resolve(cliDir, "conversations", `${id}.db`),
    resolve(cliDir, "annotations", `${id}.pbtxt`),
    resolve(cliDir, "presence", `${id}.lock`),
  ];
  for (const file of files) {
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, "x");
  }
  return [brain, ...files];
}

function initEvent(conversationId: string): string {
  return JSON.stringify({ event: "init", conversation_id: conversationId, init: {} });
}

describe("buildAntigravityArgs", () => {
  test("streams JSON both ways under the tool-less inference agent", () => {
    const args = buildAntigravityArgs({ user: "hi" });
    expect(flagValue(args, "--input-format")).toBe("stream-json");
    expect(flagValue(args, "--output-format")).toBe("stream-json");
    expect(flagValue(args, "--agent")).toBe(INFERENCE_AGENT);
  });

  test("the tier picks the model", () => {
    expect(flagValue(buildAntigravityArgs({ user: "hi" }), "--model")).toBe(
      inferenceModel("antigravity-spawn", "small")
    );
    expect(
      flagValue(buildAntigravityArgs({ user: "hi", tier: "medium" }), "--model")
    ).toBe(inferenceModel("antigravity-spawn", "medium"));
  });

  test("no argv element carries the prompt, a newline, or a permission bypass", () => {
    const args = buildAntigravityArgs({ system: "Be terse", user: "summarize this" });
    expect(args).not.toContain("summarize this");
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args.filter((a) => a.includes("\n"))).toEqual([]);
  });
});

describe("streamJsonPrompt", () => {
  test("is one NDJSON user event that keeps the prompt's newlines", () => {
    const line = streamJsonPrompt("first\nsecond");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      event: "user",
      message: { content: "first\nsecond" },
    });
  });
});

describe("extractAntigravityText", () => {
  test("returns the result event's response", () => {
    const raw = [
      JSON.stringify({ event: "init", init: { tools: [] } }),
      JSON.stringify({ event: "step_update", step_update: { text_delta: "partial" } }),
      resultEvent("SUCCESS", "Four Word Session Title\n"),
    ].join("\n");
    expect(extractAntigravityText(raw)).toBe("Four Word Session Title");
  });

  test("a failed run yields nothing", () => {
    expect(extractAntigravityText(resultEvent("ERROR", "half an answer"))).toBe("");
  });

  test("skips lines that are not JSON", () => {
    expect(extractAntigravityText(`warning: x\n${resultEvent("SUCCESS", "OK")}`)).toBe(
      "OK"
    );
  });
});

describe("inference dispatcher — agy spawn integration (fake binary)", () => {
  const saved = Object.fromEntries(PRESERVED.map((k) => [k, process.env[k]]));
  let tmpBin: string;

  beforeEach(() => {
    for (const k of PRESERVED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    tmpBin = freshTestDir(import.meta.file);
    process.env.PAL_HOME = tmpBin;
    process.env.PAL_GEMINI_DIR = resolve(tmpBin, ".gemini");
    delete process.env.PAL_ANTHROPIC_API_KEY;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    delete process.env.PAL_INFERENCE_DISABLED;
    process.env.PAL_AGENT = "antigravity";
  });

  test("the prompt arrives on stdin in an empty workspace holding only the inference agent", async () => {
    writeFakeBin(
      tmpBin,
      "agy",
      `import { existsSync, readdirSync, readFileSync } from "node:fs";
const input = JSON.parse((await Bun.stdin.text()).trim());
const agent = \`\${process.cwd()}/.agents/agents/${INFERENCE_AGENT}.md\`;
const response = JSON.stringify({
  content: input.message.content,
  workspace: readdirSync(process.cwd()),
  toolless: existsSync(agent) && readFileSync(agent, "utf-8").includes("tools: []"),
  sentinel: process.env.${SPAWN_GUARD_ENV.SENTINEL},
  cwd: process.cwd(),
});
console.log(JSON.stringify({ event: "result", result: { status: "SUCCESS", response } }));\n`
    );
    prependPath(tmpBin);

    const result = await inference({ system: "Be terse", user: "line one\nline two" });
    expect(result.success).toBe(true);
    const seen = JSON.parse(result.output ?? "{}");
    expect(seen.content).toBe("Be terse\n\nline one\nline two");
    expect(seen.workspace).toEqual([".agents"]);
    expect(seen.toolless).toBe(true);
    expect(seen.sentinel).toBe("1");
    expect(seen.cwd).not.toBe(process.cwd());
    expect(existsSync(seen.cwd)).toBe(false);
  });

  test("a schema request parses the JSON in the response", async () => {
    writeFakeBin(
      tmpBin,
      "agy",
      `console.log(${JSON.stringify(resultEvent("SUCCESS", '{"rating": 9}\n'))});\n`
    );
    prependPath(tmpBin);

    const result = await inference({
      user: "rate",
      jsonSchema: { type: "object", properties: { rating: { type: "integer" } } },
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output ?? "{}")).toEqual({ rating: 9 });
  });

  test("an ERROR result with a non-zero exit fails", async () => {
    writeFakeBin(
      tmpBin,
      "agy",
      `console.log(${JSON.stringify(resultEvent("ERROR", ""))});\nprocess.exit(1);\n`
    );
    prependPath(tmpBin);

    expect((await inference({ user: "hi" })).success).toBe(false);
  });

  test("the spawned conversation is removed and the user's own is kept", async () => {
    const cliDir = resolve(tmpBin, ".gemini", "antigravity-cli");
    const spawned = seedConversation(cliDir, SPAWNED);
    const usersOwn = seedConversation(cliDir, USERS_OWN);
    const stdout = `${initEvent(SPAWNED)}\n${resultEvent("SUCCESS", "OK")}`;
    writeFakeBin(tmpBin, "agy", `console.log(${JSON.stringify(stdout)});\n`);
    prependPath(tmpBin);

    expect((await inference({ user: "hi" })).output).toBe("OK");
    expect(spawned.filter(existsSync)).toEqual([]);
    expect(usersOwn.filter(existsSync)).toEqual(usersOwn);
  });

  test("a failed run still removes its conversation", async () => {
    const cliDir = resolve(tmpBin, ".gemini", "antigravity-cli");
    const spawned = seedConversation(cliDir, SPAWNED);
    const stdout = `${initEvent(SPAWNED)}\n${resultEvent("ERROR", "")}`;
    writeFakeBin(
      tmpBin,
      "agy",
      `console.log(${JSON.stringify(stdout)});\nprocess.exit(1);\n`
    );
    prependPath(tmpBin);

    expect((await inference({ user: "hi" })).success).toBe(false);
    expect(spawned.filter(existsSync)).toEqual([]);
  });

  test("an id that is not a conversation id removes nothing", async () => {
    const cliDir = resolve(tmpBin, ".gemini", "antigravity-cli");
    mkdirSync(cliDir, { recursive: true });
    const outside = resolve(cliDir, "keep.db");
    writeFileSync(outside, "x");
    const stdout = `${initEvent("../keep")}\n${resultEvent("SUCCESS", "OK")}`;
    writeFakeBin(tmpBin, "agy", `console.log(${JSON.stringify(stdout)});\n`);
    prependPath(tmpBin);

    expect((await inference({ user: "hi" })).output).toBe("OK");
    expect(existsSync(outside)).toBe(true);
  });
});
