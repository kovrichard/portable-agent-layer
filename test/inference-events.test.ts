import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inference } from "../src/hooks/lib/inference";
import { reload } from "../src/hooks/lib/settings";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { freshTestDir } from "./lib/test-home";

const PRESERVED = ["PAL_AGENT", "PAL_HOME", "PAL_INFERENCE_DISABLED", "PATH"] as const;
const saved = Object.fromEntries(PRESERVED.map((k) => [k, process.env[k]]));
let home: string;

function calls(): Record<string, unknown>[] {
  const file = resolve(
    home,
    "memory",
    "events",
    `${new Date().toISOString().slice(0, 7)}.jsonl`
  );
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "inference_call");
}

beforeEach(() => {
  for (const k of PRESERVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "copilot";
  delete process.env.PAL_INFERENCE_DISABLED;
  delete process.env[SPAWN_GUARD_ENV.SENTINEL];
  delete process.env[SPAWN_GUARD_ENV.DEPTH];
  reload();
  writeFakeBin(
    home,
    "copilot",
    `for await (const c of Bun.stdin.stream()) Bun.write(Bun.stdout, c);\n`
  );
  prependPath(home);
});

describe("an inference call", () => {
  test("logs who asked, the route, how long it took, and that it worked", async () => {
    const result = await inference({ user: "hi", caller: "rating", sessionId: "s1" });
    expect(result.success).toBe(true);
    const [call] = calls();
    expect(call).toMatchObject({
      session: "s1",
      caller: "rating",
      route: "copilot-spawn",
      tier: "small",
      web: false,
      failure: null,
    });
    expect(call?.latencyMs as number).toBeGreaterThanOrEqual(0);
  });

  test("a JSON reply that misses its schema, and a reply with no JSON, are told apart", async () => {
    const jsonSchema = {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
    };
    writeFakeBin(home, "copilot", `console.log('{"y":1}');\n`);
    await inference({ user: "q", caller: "session-name", jsonSchema });
    writeFakeBin(home, "copilot", `console.log("just prose");\n`);
    await inference({ user: "q", caller: "session-name", jsonSchema });
    expect(calls().map((c) => c.failure)).toEqual(["schema", "unparsable"]);
  });

  test("a binary that exits with an error, and one that prints nothing, are told apart", async () => {
    writeFakeBin(home, "copilot", `console.error("rate limited"); process.exit(1);\n`);
    await inference({ user: "q" });
    writeFakeBin(home, "copilot", "");
    await inference({ user: "q" });
    expect(calls().map((c) => c.failure)).toEqual(["error", "no-reply"]);
  });

  test("a call with no route is logged as unavailable, and the prompt never is", async () => {
    process.env.PAL_INFERENCE_DISABLED = "1";
    await inference({ user: "a private prompt" });
    expect(calls()[0]).toMatchObject({
      caller: "anonymous",
      route: "disabled",
      failure: "unavailable",
    });
    expect(JSON.stringify(calls())).not.toContain("private prompt");
  });
});
