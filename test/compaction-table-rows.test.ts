import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WindowEntry } from "../src/hooks/lib/compaction-backtest";
import { appendEvent, eventsSince, type LoggedEvent } from "../src/hooks/lib/events";
import { reload } from "../src/hooks/lib/settings";
import { freshTestDir } from "./lib/test-home";

const nearLib = () => import("../src/hooks/lib/compaction-near");
const modelsLib = () => import("../src/hooks/lib/models");
const backtestLib = () => import("../src/hooks/lib/compaction-backtest");
const cliLib = () => import("../src/cli/compaction");

const WINDOW_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
const IDLE_ENV = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS";

describe("compaction_near table rows", () => {
  let home: string;
  let since: Date;

  beforeEach(() => {
    home = freshTestDir(import.meta.file);
    process.env.PAL_HOME = home;
    process.env.PAL_CLAUDE_DIR = resolve(home, "claude-dir");
    process.env.PAL_AGENT = "claude";
    delete process.env.PAL_SPAWNED_INFERENCE;
    delete process.env[WINDOW_ENV];
    delete process.env[IDLE_ENV];
    mkdirSync(resolve(home, "memory"), { recursive: true });
    mkdirSync(resolve(home, "claude-dir"), { recursive: true });
    writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
    reload();
    since = new Date(Date.now() - 1000);
  });

  function transcriptWith(name: string, tokens: number): string {
    const path = resolve(home, name);
    const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 10 };
    writeFileSync(path, `${JSON.stringify({ message: { usage } })}\n`);
    return path;
  }

  const payloadFor = (transcript_path: string) => ({
    session_id: "sess-1",
    transcript_path,
  });
  const written = () => eventsSince("compaction_near", since);

  async function resolved(
    settings: unknown[],
    {
      model = "m",
      modelContextWindow = 1_000_000,
      env = {},
      cache = {},
    }: {
      model?: string | null;
      modelContextWindow?: number | null;
      env?: Record<string, string | undefined>;
      cache?: Record<string, unknown>;
    } = {}
  ) {
    const { resolveCompactionWindow } = await nearLib();
    const settingsFiles = settings.map((body, index) => {
      const path = resolve(home, `settings-${index}.json`);
      writeFileSync(path, JSON.stringify(body));
      return path;
    });
    const claudeJsonPath = resolve(home, "claude.json");
    writeFileSync(claudeJsonPath, JSON.stringify({ autoCompactWindowsCache: cache }));
    return resolveCompactionWindow({
      model,
      modelContextWindow,
      env,
      settingsFiles,
      claudeJsonPath,
    });
  }
  const modelWindow = { tokens: 1_000_000, source: "model" };

  describe("model limits rows (empty MODEL_LIMITS table)", () => {
    test.each([[null], ["claude-opus-5-5"], ["constructor"]])(
      "model %p has no limits",
      async (model) => {
        const { modelLimitsFor } = await modelsLib();
        expect(modelLimitsFor(model)).toBeNull();
      }
    );
  });

  describe("usable window rows, read through compactionMarginTokens at fraction 1", () => {
    test.each([
      [500_000, 1_000_000, 64_000, 480_000],
      [500_000, 200_000, 64_000, 180_000],
      [500_000, 1_000_000, 8_000, 492_000],
    ])(
      "window %i, model %i, max output %i leaves %i usable",
      async (window, modelContextWindow, modelMaxOutput, expected) => {
        const { compactionMarginTokens } = await nearLib();
        expect(
          compactionMarginTokens({ window, modelContextWindow, modelMaxOutput }, 1)
        ).toBe(expected);
      }
    );
  });

  describe("compactionMarginTokens rows", () => {
    test("500000/500000/20000 at the default fraction is 96000", async () => {
      const { compactionMarginTokens } = await nearLib();
      expect(
        compactionMarginTokens({
          window: 500_000,
          modelContextWindow: 500_000,
          modelMaxOutput: 20_000,
        })
      ).toBe(96_000);
    });

    test("500000/500000/20000 at fraction 0.5 is 240000", async () => {
      const { compactionMarginTokens } = await nearLib();
      expect(
        compactionMarginTokens(
          { window: 500_000, modelContextWindow: 500_000, modelMaxOutput: 20_000 },
          0.5
        )
      ).toBe(240_000);
    });

    test("300000/300000/20000 at the default fraction is 56000", async () => {
      const { compactionMarginTokens } = await nearLib();
      expect(
        compactionMarginTokens({
          window: 300_000,
          modelContextWindow: 300_000,
          modelMaxOutput: 20_000,
        })
      ).toBe(56_000);
    });
  });

  describe("compactionPredicted rows", () => {
    test.each([
      [96_000, 96_000, true],
      [-5, 96_000, true],
      [96_001, 96_000, false],
    ])("tokensLeft %i against margin %i is %s", async (tokensLeft, margin, expected) => {
      const { compactionPredicted } = await nearLib();
      expect(compactionPredicted(tokensLeft, margin)).toBe(expected);
    });
  });

  describe("compactionInput rows", () => {
    test('model "claude-opus-5-5" with window 500000 takes the window as both sizes', async () => {
      const { compactionInput } = await nearLib();
      expect(compactionInput("claude-opus-5-5", 500_000)).toEqual({
        window: 500_000,
        modelContextWindow: 500_000,
        modelMaxOutput: 20_000,
      });
    });

    test("a null model with window 300000 takes the window as both sizes", async () => {
      const { compactionInput } = await nearLib();
      expect(compactionInput(null, 300_000)).toEqual({
        window: 300_000,
        modelContextWindow: 300_000,
        modelMaxOutput: 20_000,
      });
    });
  });

  describe("resolveCompactionWindow rows", () => {
    test("a per-model autoCompactWindow of 300000 for the model gives settings 300000", async () => {
      expect(
        await resolved([{ modelSettings: { m: { autoCompactWindow: 300_000 } } }])
      ).toEqual({
        tokens: 300_000,
        source: "settings",
      });
    });

    test('a per-model autoCompactWindow of "auto" is skipped for the model window', async () => {
      expect(
        await resolved([{ modelSettings: { m: { autoCompactWindow: "auto" } } }])
      ).toEqual(modelWindow);
    });

    test("a per-model window does not apply to a null model", async () => {
      expect(
        await resolved([{ modelSettings: { m: { autoCompactWindow: 300_000 } } }], {
          model: null,
        })
      ).toEqual(modelWindow);
    });

    test("a top-level autoCompactWindow of 400000 is the settings window, not a per-model one", async () => {
      expect(await resolved([{ autoCompactWindow: 400_000 }])).toEqual({
        tokens: 400_000,
        source: "settings",
      });
    });

    test('a top-level autoCompactWindow of "auto" is skipped', async () => {
      expect(await resolved([{ autoCompactWindow: "auto" }])).toEqual(modelWindow);
    });

    test("a settings file with no window is skipped", async () => {
      expect(await resolved([{}])).toEqual(modelWindow);
    });

    test("a settings env block with CLAUDE_CODE_AUTO_COMPACT_WINDOW 500000 gives settings-env 500000", async () => {
      expect(await resolved([{ env: { [WINDOW_ENV]: "500000" } }])).toEqual({
        tokens: 500_000,
        source: "settings-env",
      });
    });

    test('a settings env block with CLAUDE_CODE_AUTO_COMPACT_WINDOW "lots" is skipped', async () => {
      expect(await resolved([{ env: { [WINDOW_ENV]: "lots" } }])).toEqual(modelWindow);
    });

    test("a settings env block with no window is skipped", async () => {
      expect(await resolved([{}])).toEqual(modelWindow);
    });

    test("a numeric settings env value 500000 counts as 500000", async () => {
      expect(await resolved([{ env: { [WINDOW_ENV]: 500_000 } }])).toEqual({
        tokens: 500_000,
        source: "settings-env",
      });
    });

    test.each(["lots", "", "auto", 0, null])(
      "a settings env value of %p is not a window",
      async (value) => {
        expect(await resolved([{ env: { [WINDOW_ENV]: value } }])).toEqual(modelWindow);
      }
    );

    test("an env block that is not an object gives no settings-env window", async () => {
      expect(await resolved([{ env: "x" }])).toEqual(modelWindow);
    });

    test('a model named "constructor" with no own per-model entry gives no window', async () => {
      expect(await resolved([{ modelSettings: {} }], { model: "constructor" })).toEqual(
        modelWindow
      );
    });
  });

  describe("idle minimum rows (CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS)", () => {
    test("an unset minimum gives 200000", async () => {
      const { recordIdleCompactionNear } = await nearLib();
      recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 250_000)));
      expect(written()[0]).toMatchObject({ idleMinTokens: 200_000 });
    });

    test('a minimum of "300000" gives 300000', async () => {
      const { recordIdleCompactionNear } = await nearLib();
      process.env[IDLE_ENV] = "300000";
      recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 320_000)));
      expect(written()[0]).toMatchObject({ idleMinTokens: 300_000 });
    });

    test('a minimum of "50000" is raised to the 100000 floor', async () => {
      const { recordIdleCompactionNear } = await nearLib();
      process.env[IDLE_ENV] = "50000";
      recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 120_000)));
      expect(written()[0]).toMatchObject({ idleMinTokens: 100_000 });
    });

    test('a minimum of "soon" gives the 200000 default', async () => {
      const { recordIdleCompactionNear } = await nearLib();
      process.env[IDLE_ENV] = "soon";
      recordIdleCompactionNear(payloadFor(transcriptWith("t.jsonl", 250_000)));
      expect(written()[0]).toMatchObject({ idleMinTokens: 200_000 });
    });
  });

  describe("project directory rows (payload cwd)", () => {
    function projectWithWindow(tokens: number): string {
      const dir = resolve(home, "project");
      mkdirSync(resolve(dir, ".claude"), { recursive: true });
      writeFileSync(
        resolve(dir, ".claude", "settings.json"),
        JSON.stringify({ autoCompactWindow: tokens })
      );
      return dir;
    }

    test("a payload cwd names the project whose settings give the window", async () => {
      const { recordCompactionNear } = await nearLib();
      const dir = projectWithWindow(400_000);
      recordCompactionNear({
        ...payloadFor(transcriptWith("t.jsonl", 300_000)),
        cwd: dir,
      });
      expect(written()[0]).toMatchObject({
        windowTokens: 400_000,
        windowSource: "settings",
      });
    });

    test("an empty payload cwd falls back to the process working directory", async () => {
      const { recordCompactionNear } = await nearLib();
      const dir = projectWithWindow(400_000);
      const original = process.cwd();
      process.chdir(dir);
      try {
        recordCompactionNear({
          ...payloadFor(transcriptWith("t.jsonl", 300_000)),
          cwd: "",
        });
      } finally {
        process.chdir(original);
      }
      expect(written()[0]).toMatchObject({
        windowTokens: 400_000,
        windowSource: "settings",
      });
    });

    test("a payload with no cwd falls back to the process working directory", async () => {
      const { recordCompactionNear } = await nearLib();
      const dir = projectWithWindow(400_000);
      const original = process.cwd();
      process.chdir(dir);
      try {
        recordCompactionNear(payloadFor(transcriptWith("t.jsonl", 300_000)));
      } finally {
        process.chdir(original);
      }
      expect(written()[0]).toMatchObject({
        windowTokens: 400_000,
        windowSource: "settings",
      });
    });
  });
});

describe("compaction backtest table rows", () => {
  let printed: string[];
  let logSpy: ReturnType<typeof spyOn> | undefined;
  let errSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    logSpy?.mockRestore();
    errSpy?.mockRestore();
    process.env.PAL_HOME = freshTestDir(import.meta.file);
    process.env.PAL_AGENT = "claude";
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    printed = [];
    logSpy = spyOn(console, "log").mockImplementation((...a) =>
      printed.push(a.join(" "))
    );
    errSpy = spyOn(console, "error").mockImplementation((...a) =>
      printed.push(a.join(" "))
    );
  });

  const MIN = 60_000;
  const BASE = Date.now() - 3 * 86_400_000;
  const at = (minute: number) => new Date(BASE + minute * MIN).toISOString();
  const ZERO_LABELS = { threshold: 0, idle: 0, unexplained: 0, no_context: 0 };
  const LEAD_START = 380_000;

  function call(
    session: string,
    minute: number,
    tokens: number,
    extra: Record<string, unknown> = {}
  ) {
    appendEvent(
      "model_call",
      {
        inputTokens: tokens - 1000,
        cacheRead: 1000,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        ...extra,
      },
      { ts: at(minute), session, runtime: "claude" }
    );
  }

  function compaction(session: string, minute: number, trigger: string, tokens: number) {
    appendEvent(
      "compaction",
      { trigger, withInstructions: false, contextTokens: tokens },
      { ts: at(minute), session }
    );
  }

  function seedHistory() {
    call("warned", 0, 100_000);
    call("warned", 10, 300_000);
    call("warned", 20, 380_000);
    call("warned", 30, 440_000);
    compaction("warned", 40, "auto", 462_000);
    call("missed", 0, 100_000);
    call("missed", 5, 300_000);
    compaction("missed", 20, "auto", 465_000);
    call("alarm", 0, 100_000);
    call("alarm", 5, 400_000);
    call("idle", 0, 250_000);
    compaction("idle", 100, "auto", 250_000);
    call("lost", 0, 100_000);
    call("lost", 10, 150_000);
    compaction("lost", 20, "auto", 150_000);
    call("quiet", 0, 100_000);
    call("quiet", 5, 400_000, { sidechain: true });
    call("quiet", 6, 400_000, { entrypoint: "sdk-cli" });
    call("manual", 0, 250_000);
    compaction("manual", 10, "manual", 465_000);
  }

  async function backtest(...args: string[]) {
    const { runCompaction } = await cliLib();
    const code = await runCompaction(["backtest", ...args]);
    return { code, text: printed.join("\n") };
  }

  function json() {
    return JSON.parse(printed[0] ?? "{}") as {
      labels: {
        threshold: number;
        idle: number;
        unexplained: number;
        no_context: number;
      };
      rows: Record<string, number | null>[];
    };
  }

  type Fields = Record<string, unknown>;

  const modelCall = (minute: number, fields: Fields = {}): LoggedEvent =>
    ({
      type: "model_call",
      ts: at(minute),
      session: "s",
      runtime: "claude",
      ...fields,
    }) as LoggedEvent;

  const compactionEvent = (
    when: number | string | null,
    trigger: string,
    contextTokens: number
  ): LoggedEvent =>
    ({
      type: "compaction",
      ts: typeof when === "number" ? at(when) : when,
      session: "s",
      runtime: "claude",
      trigger,
      contextTokens,
    }) as unknown as LoggedEvent;

  const flat = (tokens: number | null) => () => tokens;

  async function scoredRow(
    calls: LoggedEvent[],
    compactions: LoggedEvent[],
    window: number,
    margin = 0.2
  ) {
    const { backtestCompaction } = await backtestLib();
    return backtestCompaction(calls, compactions, [margin], flat(window)).rows[0];
  }

  async function leadTokensWhenLastCallHas(fields: Fields) {
    const row = await scoredRow(
      [modelCall(0, { inputTokens: LEAD_START }), modelCall(10, fields)],
      [compactionEvent(20, "auto", 462_000)],
      500_000
    );
    return row?.medianLeadTokens;
  }

  describe("parsesAsTime rows (compaction timestamps)", () => {
    const labelsWithCompactionTs = async (when: number | string | null) => {
      const { backtestCompaction } = await backtestLib();
      return backtestCompaction(
        [modelCall(0, { inputTokens: 100_000 })],
        [compactionEvent(when, "auto", 462_000)],
        [0.2],
        flat(500_000)
      ).labels;
    };

    test("a valid ISO timestamp keeps the compaction", async () => {
      expect((await labelsWithCompactionTs(20)).threshold).toBe(1);
    });

    test('a "never" timestamp drops the compaction', async () => {
      expect(await labelsWithCompactionTs("never")).toEqual(ZERO_LABELS);
    });

    test("a null timestamp drops the compaction", async () => {
      expect(await labelsWithCompactionTs(null)).toEqual(ZERO_LABELS);
    });
  });

  describe("token counting rows", () => {
    test("a numeric inputTokens of 5 counts as 5", async () => {
      expect(await leadTokensWhenLastCallHas({ inputTokens: 5 })).toBe(5 - LEAD_START);
    });

    test('a string inputTokens of "5" counts as 0', async () => {
      expect(await leadTokensWhenLastCallHas({ inputTokens: "5" })).toBe(0 - LEAD_START);
    });

    test("an undefined inputTokens counts as 0", async () => {
      expect(await leadTokensWhenLastCallHas({ inputTokens: undefined })).toBe(
        0 - LEAD_START
      );
    });

    test("the four token fields sum to 100000 for 99000 + 1000", async () => {
      expect(
        await leadTokensWhenLastCallHas({
          inputTokens: 99_000,
          cacheRead: 1_000,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        })
      ).toBe(100_000 - LEAD_START);
    });

    test("the token fields sum to 12 for 5 + 7", async () => {
      expect(await leadTokensWhenLastCallHas({ inputTokens: 5, cacheWrite1h: 7 })).toBe(
        12 - LEAD_START
      );
    });

    test("a call with no token fields counts as 0", async () => {
      expect(await leadTokensWhenLastCallHas({})).toBe(0 - LEAD_START);
    });
  });

  describe("main-thread call rows", () => {
    const falseAlarmsOf = async (fields: Fields) =>
      (await scoredRow([modelCall(0, { inputTokens: 380_000, ...fields })], [], 500_000))
        ?.falseAlarms;

    test('a runtime "claude" call on the main thread counts', async () => {
      expect(await falseAlarmsOf({})).toBe(1);
    });

    test("a sidechain call does not count", async () => {
      expect(await falseAlarmsOf({ sidechain: true })).toBe(0);
    });

    test('an entrypoint "sdk-cli" call does not count', async () => {
      expect(await falseAlarmsOf({ entrypoint: "sdk-cli" })).toBe(0);
    });
  });

  describe("segment rows", () => {
    test("call@0, call@10, compaction@20 is one segment that warns from call@0", async () => {
      expect(
        await scoredRow(
          [
            modelCall(0, { inputTokens: 380_000 }),
            modelCall(10, { inputTokens: 440_000 }),
          ],
          [compactionEvent(20, "auto", 462_000)],
          500_000
        )
      ).toMatchObject({
        warned: 1,
        missed: 0,
        medianLeadMinutes: 20,
        medianLeadTokens: 60_000,
      });
    });

    test("compaction@5 alone is a threshold compaction with no calls, so it is missed", async () => {
      const { backtestCompaction } = await backtestLib();
      const result = backtestCompaction(
        [],
        [compactionEvent(5, "auto", 462_000)],
        [0.2],
        flat(500_000)
      );
      expect(result.labels.threshold).toBe(1);
      expect(result.rows[0]).toMatchObject({ warned: 0, missed: 1 });
    });

    test("call@0, compaction@10 (manual) is not scored", async () => {
      const { backtestCompaction } = await backtestLib();
      const result = backtestCompaction(
        [modelCall(0, { inputTokens: 380_000 })],
        [compactionEvent(10, "manual", 465_000)],
        [0.2],
        flat(500_000)
      );
      expect(result.labels).toEqual(ZERO_LABELS);
      expect(result.rows[0]).toMatchObject({ warned: 0, missed: 0, falseAlarms: 0 });
    });

    test("call@0 alone is a trailing segment with no compaction, so a reaching call is a false alarm", async () => {
      expect(
        await scoredRow([modelCall(0, { inputTokens: 380_000 })], [], 500_000)
      ).toMatchObject({
        falseAlarms: 1,
      });
    });
  });

  describe("label rows", () => {
    const call1 = (minute: number, inputTokens: number) =>
      modelCall(minute, { inputTokens });

    test.each([
      [
        "auto 462000 with no calls is threshold",
        [],
        [compactionEvent(20, "auto", 462_000)],
        500_000,
        { threshold: 1, idle: 0, unexplained: 0, no_context: 0 },
      ],
      [
        "auto 250000 after a call 100 min earlier is idle",
        [call1(0, 100_000)],
        [compactionEvent(100, "auto", 250_000)],
        500_000,
        { threshold: 0, idle: 1, unexplained: 0, no_context: 0 },
      ],
      [
        "auto 150000 after a call 10 min earlier is unexplained",
        [call1(0, 100_000)],
        [compactionEvent(10, "auto", 150_000)],
        500_000,
        { threshold: 0, idle: 0, unexplained: 1, no_context: 0 },
      ],
      [
        "auto 150000 with no previous call is unexplained",
        [],
        [compactionEvent(20, "auto", 150_000)],
        500_000,
        { threshold: 0, idle: 0, unexplained: 1, no_context: 0 },
      ],
      [
        "auto 470000 above the point after a call 10 min earlier is threshold",
        [call1(0, 100_000)],
        [compactionEvent(10, "auto", 470_000)],
        500_000,
        { threshold: 1, idle: 0, unexplained: 0, no_context: 0 },
      ],
      [
        "manual 465000 is not labelled",
        [],
        [compactionEvent(20, "manual", 465_000)],
        500_000,
        ZERO_LABELS,
      ],
      [
        "auto 462000 under a 300000 window is unexplained after a call 40 min earlier",
        [call1(0, 100_000)],
        [compactionEvent(40, "auto", 462_000)],
        300_000,
        { threshold: 0, idle: 0, unexplained: 1, no_context: 0 },
      ],
    ])("%s", async (_name, calls, compactions, window, expected) => {
      const { backtestCompaction } = await backtestLib();
      expect(
        backtestCompaction(
          calls as LoggedEvent[],
          compactions as LoggedEvent[],
          [0.2],
          flat(window as number)
        ).labels
      ).toEqual(expected);
    });
  });

  describe("reaching rows (a call reaches the margin)", () => {
    const alarmsFor = async (tokens: number, window: number | null, margin: number) => {
      const { backtestCompaction } = await backtestLib();
      return backtestCompaction(
        [modelCall(0, { inputTokens: tokens })],
        [],
        [margin],
        flat(window)
      ).rows[0]?.falseAlarms;
    };

    test("380000 tokens with a 500000 window at margin 0.2 reaches", async () => {
      expect(await alarmsFor(380_000, 500_000, 0.2)).toBe(1);
    });

    test("300000 tokens with a 500000 window at margin 0.2 does not reach", async () => {
      expect(await alarmsFor(300_000, 500_000, 0.2)).toBe(0);
    });

    test("300000 tokens with a 500000 window at margin 0.5 reaches", async () => {
      expect(await alarmsFor(300_000, 500_000, 0.5)).toBe(1);
    });

    test.each([0, 380_000, 900_000])(
      "%i tokens with no window never reach",
      async (tokens) => {
        expect(await alarmsFor(tokens, null, 0.2)).toBe(0);
      }
    );
  });

  describe("window per moment rows", () => {
    const UNTIL = Date.parse("2026-11-05T09:16:00+01:00");
    const ms = (minute: number) => Date.parse(at(minute));
    const nearEvent = (minute: number): LoggedEvent =>
      ({
        type: "compaction_near",
        ts: at(minute),
        session: "s",
        runtime: "claude",
        trigger: "threshold",
        windowTokens: 300_000,
      }) as unknown as LoggedEvent;

    async function windowAt(
      schedule: WindowEntry[],
      near: LoggedEvent[] = [],
      current: number | null = null
    ) {
      const { windowResolver } = await backtestLib();
      return windowResolver(near, schedule, () => current);
    }

    test("a moment before the until time gets the bounded 300000 entry", async () => {
      const resolve300 = await windowAt([
        { tokens: 300_000, until: UNTIL },
        { tokens: 500_000, until: null },
      ]);
      expect(resolve300("s", UNTIL - 60_000, null)).toBe(300_000);
    });

    test("a moment at the until time gets the open-ended 500000 entry", async () => {
      const resolve500 = await windowAt([
        { tokens: 300_000, until: UNTIL },
        { tokens: 500_000, until: null },
      ]);
      expect(resolve500("s", UNTIL, null)).toBe(500_000);
    });

    test("a moment after the only bounded entry gets no schedule window", async () => {
      expect(
        (await windowAt([{ tokens: 300_000, until: UNTIL }]))("s", UNTIL, null)
      ).toBeNull();
    });

    test.each([UNTIL - 1, UNTIL, UNTIL + 60_000])(
      "an empty schedule gives null at %i",
      async (ts) => {
        expect((await windowAt([]))("s", ts, null)).toBeNull();
      }
    );

    test("a compaction_near event 1 min before the moment gives its 300000", async () => {
      expect((await windowAt([], [nearEvent(1)], 500_000))("s", ms(10), null)).toBe(
        300_000
      );
    });

    test("a moment 0 min after the compaction_near event falls back to the current window", async () => {
      expect((await windowAt([], [nearEvent(1)], 500_000))("s", ms(0), null)).toBe(
        500_000
      );
    });

    test("no compaction_near events fall back to the current window", async () => {
      expect((await windowAt([], [], 500_000))("s", ms(10), null)).toBe(500_000);
    });
  });

  describe("command rows", () => {
    beforeEach(() => {
      process.env.PAL_CLAUDE_DIR = resolve(process.env.PAL_HOME ?? "", "claude-dir");
    });

    test("no --margin prints the default 0.2 row first", async () => {
      const { code } = await backtest("--window", "500000");
      expect(code).toBe(0);
      expect(printed[0]?.startsWith("margin 0.2:")).toBe(true);
    });

    test('--margin "0.2,0.5" prints a row for each margin in order', async () => {
      const { code } = await backtest("--window", "500000", "--margin", "0.2,0.5");
      expect(code).toBe(0);
      expect(printed[0]?.startsWith("margin 0.2:")).toBe(true);
      expect(printed[1]?.startsWith("margin 0.5:")).toBe(true);
    });

    test.each(["1.5", "0", "0.2,abc", ""])(
      "--margin %p is a usage error with exit 1",
      async (raw) => {
        expect((await backtest("--margin", raw)).code).toBe(1);
      }
    );

    test('a "500000" --window applies to every moment', async () => {
      seedHistory();
      await backtest("--window", "500000", "--json");
      expect(json().labels.threshold).toBe(2);
    });

    test("a bounded --window applies only before its until time", async () => {
      call("s", 0, 100_000);
      compaction("s", 10, "auto", 265_000);
      await backtest("--window", `300000@${at(60)}`, "--json");
      expect(json().labels.threshold).toBe(1);
    });

    test.each(["lots", "500000@never", "0"])(
      "--window %p is a usage error with exit 1",
      async (raw) => {
        expect((await backtest("--window", raw)).code).toBe(1);
      }
    );

    test("no --window gives an empty schedule, so the window is the current one", async () => {
      call("s", 0, 100_000);
      compaction("s", 10, "auto", 265_000);
      await backtest("--json");
      expect(json().labels.threshold).toBe(0);
    });

    test("two --window entries apply in until order whatever the argument order", async () => {
      call("s", 0, 100_000);
      compaction("s", 10, "auto", 265_000);
      await backtest("--window", "500000", "--window", `300000@${at(60)}`, "--json");
      expect(json().labels.threshold).toBe(1);
    });

    test("two open-ended --window entries are a usage error with exit 1", async () => {
      expect((await backtest("--window", "500000", "--window", "300000")).code).toBe(1);
    });

    test("a row with 1 warned, 1 missed, 1 false alarm and leads 20 min / 60000 tokens prints one line", async () => {
      seedHistory();
      await backtest("--window", "500000", "--margin", "0.2");
      expect(printed[0]).toBe(
        "margin 0.2: 1 warned, 1 missed, 1 false alarms, median lead 20.0 min / 60000 tokens"
      );
    });

    test("a row with 2 warned, 0 missed, 1 false alarm and leads 22.5 min / 70000 tokens prints one line", async () => {
      seedHistory();
      await backtest("--window", "500000", "--margin", "0.5");
      expect(printed[0]).toBe(
        "margin 0.5: 2 warned, 0 missed, 1 false alarms, median lead 22.5 min / 70000 tokens"
      );
    });

    test("a row with no lead prints dashes for the leads", async () => {
      call("s", 0, 100_000);
      call("s", 5, 120_000);
      compaction("s", 20, "auto", 465_000);
      await backtest("--window", "500000", "--margin", "0.2");
      expect(printed[0]).toBe(
        "margin 0.2: 0 warned, 1 missed, 0 false alarms, median lead - min / - tokens"
      );
    });

    test("the label line reads 2 threshold, 1 idle, 1 unexplained for the seeded history", async () => {
      seedHistory();
      await backtest("--window", "500000");
      expect(printed[printed.length - 1]).toBe(
        "auto compactions: 2 threshold, 1 idle, 1 unexplained"
      );
    });

    test("the label line reads zeros for an empty history", async () => {
      await backtest("--window", "500000", "--days", "3650");
      expect(printed[printed.length - 1]).toBe(
        "auto compactions: 0 threshold, 0 idle, 0 unexplained"
      );
    });

    test("the label line reads 1 threshold for a single threshold compaction", async () => {
      call("s", 0, 100_000);
      compaction("s", 10, "auto", 465_000);
      await backtest("--window", "500000");
      expect(printed[printed.length - 1]).toBe(
        "auto compactions: 1 threshold, 0 idle, 0 unexplained"
      );
    });
  });
});
