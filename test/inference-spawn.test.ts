import { beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CliReply,
  inferenceViaCliSpawn,
  type SpawnPlace,
} from "../src/hooks/lib/inference-spawn";
import type { InferenceOptions } from "../src/hooks/lib/inference-types";
import { debugHome, type FakeRun, withFakeSpawn } from "./lib/fake-spawn";
import { restoreEnv, savedEnv } from "./lib/inference-dispatch-fixture";

const BASELINE = savedEnv();
let home = { home: "", log: () => "" };

beforeEach(() => {
  restoreEnv(BASELINE);
  home = debugHome(import.meta.file);
});

interface Call {
  runs: FakeRun[];
  opts?: InferenceOptions;
  reply?: CliReply;
  place?: SpawnPlace;
  binary?: string;
  stdin?: string;
}

async function dispatch({
  runs,
  opts = { user: "hi" },
  reply,
  place,
  binary = "/usr/bin/claude",
  stdin = "prompt",
}: Call) {
  const { value, calls } = await withFakeSpawn(runs, () =>
    inferenceViaCliSpawn(binary, ["-p"], stdin, opts, reply, place)
  );

  return { result: value, calls };
}

describe("a successful run", () => {
  test("returns the trimmed stdout and spawns with piped streams", async () => {
    const { result, calls } = await dispatch({ runs: [{ stdout: "  hello \n" }] });

    expect(result).toStrictEqual({ success: true, output: "hello", usage: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(["/usr/bin/claude", "-p"]);
    expect(calls[0].options).toMatchObject({
      cwd: undefined,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    expect(calls[0].writes).toEqual(["prompt"]);
    expect(calls[0].ended).toBe(true);
  });

  test("an empty prompt is never written, but stdin still closes", async () => {
    const { calls } = await dispatch({ runs: [{ stdout: "ok" }], stdin: "" });

    expect(calls[0].writes).toEqual([]);
    expect(calls[0].ended).toBe(true);
  });

  test("a numeric stdin is left alone", async () => {
    const { result } = await dispatch({ runs: [{ stdout: "ok", stdin: "number" }] });

    expect(result.output).toBe("ok");
    expect(home.log()).not.toContain("inference:stdin");
  });

  test("a stdin that throws is logged and the run goes on", async () => {
    const { result } = await dispatch({ runs: [{ stdout: "ok", stdin: "throws" }] });

    expect(result.output).toBe("ok");
    expect(home.log()).toContain("ERROR inference:stdin: stdin closed");
  });

  test("the child gets the guarded env, the .env file, and the place's overrides", async () => {
    writeFileSync(resolve(home.home, ".env"), "PAL_FROM_FILE=yes\n");
    const { calls } = await dispatch({
      runs: [{ stdout: "ok" }],
      place: { cwd: "/work", env: { PAL_INFERENCE_DEPTH: "7", EXTRA: "1" } },
    });
    const env = calls[0].options.env as Record<string, string | undefined>;

    expect(calls[0].options.cwd).toBe("/work");
    expect(env.PAL_SPAWNED_INFERENCE).toBe("1");
    expect(env.PAL_FROM_FILE).toBe("yes");
    expect(env.PAL_INFERENCE_DEPTH).toBe("7");
    expect(env.EXTRA).toBe("1");
  });

  test("the reply reader gets trimmed text, and usage and afterRun the raw stdout", async () => {
    const seen: string[] = [];
    const { result } = await dispatch({
      runs: [{ stdout: " ab \n" }],
      reply: {
        text: (raw) => raw.toUpperCase(),
        usage: (raw) => ({ inputTokens: raw.length }),
      },
      place: { afterRun: (raw) => seen.push(raw) },
    });

    expect(result).toStrictEqual({
      success: true,
      output: "AB",
      usage: { inputTokens: 5 },
    });
    expect(seen).toEqual([" ab \n"]);
  });

  test("debug log names caller, session, tag, binary and size", async () => {
    await dispatch({
      runs: [{ stdout: "four" }],
      opts: { user: "hi", caller: "judge", sessionId: "s1" },
      place: { logTag: "auth=token" },
      binary: "/opt/bin/claude.CMD",
    });

    expect(home.log()).toContain(
      "DEBUG inference:spawn: caller=judge sessionId=s1 auth=token done binary=claude success=true bytes=4 elapsedMs="
    );
    expect(home.log()).toMatch(/ elapsedMs=\d{1,5}\n/);
  });

  test("an untagged call logs anonymous with no session", async () => {
    await dispatch({ runs: [{ code: 0 }] });

    expect(home.log()).toContain(
      "inference:spawn: caller=anonymous sessionId=- done binary=claude success=false bytes=0 elapsedMs="
    );
  });

  test.each([
    ["/x/codex.exe", "codex"],
    ["/x/agy.bat", "agy"],
    ["/x/tool.com", "tool"],
    ["/x/tool.cmd.sh", "tool.cmd.sh"],
    ["/x/cmd", "cmd"],
  ])("binary %s logs as %s", async (binary, name) => {
    await dispatch({ runs: [{ stdout: "ok" }], binary });

    expect(home.log()).toContain(`done binary=${name} success`);
  });
});

describe("an empty abort", () => {
  test("is retried once, and the retry's result wins", async () => {
    const { result, calls } = await dispatch({ runs: [{ code: 1 }, { stdout: "ok" }] });

    expect(result.output).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(home.log()).toContain(
      "inference:spawn: caller=anonymous sessionId=- retry: empty-abort binary=claude exit=1 after "
    );
    expect(home.log()).toMatch(/ after \d{1,5}ms, jitter=0ms\n/);
  });

  test("fails without an error line when the retry aborts too", async () => {
    const { result, calls } = await dispatch({ runs: [{ code: 1 }] });

    expect(result).toStrictEqual({ success: false, error: undefined, usage: undefined });
    expect(calls).toHaveLength(2);
  });

  test("a spawn that throws is logged and retried", async () => {
    const { result, calls } = await dispatch({ runs: [{ spawnThrows: true }] });

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(2);
    expect(home.log()).toContain("ERROR inference:spawn: ENOENT: no such binary");
  });

  test("a clean exit with no output is not retried", async () => {
    const { result, calls } = await dispatch({ runs: [{ code: 0 }] });

    expect(result).toStrictEqual({ success: false, usage: undefined });
    expect(calls).toHaveLength(1);
    expect(home.log()).not.toContain("extract-empty");
  });
});

describe("a failed exit", () => {
  test("with stderr is not retried and reports stderr's first line", async () => {
    const stderr = "  \n  bad thing  \nmore";
    const { result, calls } = await dispatch({ runs: [{ code: 2, stderr }] });

    expect(result).toStrictEqual({
      success: false,
      error: "bad thing",
      usage: undefined,
    });
    expect(calls).toHaveLength(1);
    expect(home.log()).toContain(
      `ERROR inference:spawn: caller=anonymous sessionId=- exited=2 binary=claude argv=["-p"] stderr(${stderr.length})=`
    );
  });

  test("with stdout only reports what the agent said", async () => {
    const stdout = JSON.stringify({ result: "quota hit\nline2" });
    const { result, calls } = await dispatch({ runs: [{ code: 1, stdout }] });

    expect(result.error).toBe("quota hit");
    expect(calls).toHaveLength(1);
    expect(home.log()).toContain(`stderr(0)= stdout(${stdout.length})=quota hit`);
  });

  test("logs at most 300 characters of each stream", async () => {
    const long = "e".repeat(400);
    await dispatch({ runs: [{ code: 1, stderr: long, stdout: "o".repeat(400) }] });

    expect(home.log()).toContain(
      `stderr(400)=${"e".repeat(300)} stdout(400)=${"o".repeat(300)}\n`
    );
  });
});

describe("a timeout", () => {
  test("kills the child, is not retried, and is logged", async () => {
    const { result, calls } = await dispatch({
      runs: [{ hang: true }],
      opts: { user: "hi", timeout: 20 },
    });

    expect(result).toStrictEqual({ success: false, usage: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].killed).toBe(true);
    expect(home.log()).toContain(
      "ERROR inference:spawn: caller=anonymous sessionId=- timeout binary=claude after 20ms"
    );
  });

  test("survives a kill that throws", async () => {
    const { result } = await dispatch({
      runs: [{ hang: true, killThrows: true }],
      opts: { user: "hi", timeout: 20 },
    });

    expect(result.success).toBe(false);
  });
});

describe("unreadable pipes", () => {
  test.each(["missing", "number", "broken"] as const)(
    "a %s pipe reads as empty",
    async (pipes) => {
      const { result } = await dispatch({ runs: [{ pipes }] });

      expect(result).toStrictEqual({ success: false, usage: undefined });
    }
  );
});

describe("reply extraction", () => {
  const nothing: CliReply = { text: () => "", usage: () => undefined };

  test("a reader that finds no text logs the raw stdout, capped at 500", async () => {
    const stdout = "r".repeat(600);
    const { result } = await dispatch({ runs: [{ stdout }], reply: nothing });

    expect(result.success).toBe(false);
    expect(home.log()).toContain(
      `ERROR inference:spawn: caller=anonymous sessionId=- extract-empty binary=claude rawStdout(600)=${"r".repeat(500)}\n`
    );
  });

  test("a schema call returns the JSON found in the reply", async () => {
    const { result } = await dispatch({
      runs: [{ stdout: 'Sure: {"a": 1} done' }],
      opts: { user: "hi", jsonSchema: { type: "object" } },
    });

    expect(result).toStrictEqual({ success: true, output: '{"a":1}', usage: undefined });
  });

  test("a schema call with no JSON fails but keeps the text", async () => {
    const { result } = await dispatch({
      runs: [{ stdout: "no json here" }],
      opts: { user: "hi", jsonSchema: { type: "object" } },
    });

    expect(result).toStrictEqual({
      success: false,
      output: "no json here",
      usage: undefined,
    });
  });
});

describe("timers", () => {
  async function delaysWhile(jitterEnv: string | undefined, runs: FakeRun[]) {
    const realSetTimeout = globalThis.setTimeout;
    const realRandom = Math.random;
    const delays: number[] = [];
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);

      return realSetTimeout(fn, ms > 2000 ? ms : 0);
    }) as typeof setTimeout;
    Math.random = () => 0.4567;

    if (jitterEnv === undefined) delete process.env.PAL_INFERENCE_RETRY_JITTER_MS;
    else process.env.PAL_INFERENCE_RETRY_JITTER_MS = jitterEnv;

    try {
      await dispatch({ runs });

      return delays;
    } finally {
      globalThis.setTimeout = realSetTimeout;
      Math.random = realRandom;
      process.env.PAL_INFERENCE_RETRY_JITTER_MS = "0";
    }
  }

  test("the default timeout is 15 s", async () => {
    expect(await delaysWhile("0", [{ stdout: "ok" }])).toEqual([15000]);
  });

  test.each([
    ["25", 25],
    ["123", 123],
    ["2a", 956],
    ["a2", 956],
    ["", 956],
  ])("jitter env %p waits %p ms before the retry", async (env, ms) => {
    const delays = await delaysWhile(env, [{ code: 1 }, { stdout: "ok" }]);

    expect(delays).toEqual([15000, ms, 15000]);
  });

  test("an unset jitter env waits 500-1500 ms", async () => {
    const delays = await delaysWhile(undefined, [{ code: 1 }, { stdout: "ok" }]);

    expect(delays).toEqual([15000, 956, 15000]);
  });
});
