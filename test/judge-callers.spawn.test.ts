import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { backfillCorrectionKinds } from "../src/hooks/lib/correction-backfill";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { claudeReplying, prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const RATING = resolve(import.meta.dir, "../src/hooks/handlers/rating.ts");

const ANSWER_BY_SYSTEM_PROMPT = `(() => {
  const args = Bun.argv;
  const system = require("node:fs").readFileSync(args[args.indexOf("--system-prompt-file") + 1], "utf-8");
  if (system.startsWith("You classify how a user reacted"))
    return JSON.stringify({ reaction: "corrected", issue: "Said CI was green" });
  if (system.includes("A first reader labelled"))
    return JSON.stringify({ reaction: "corrected", issue: "Said CI was green" });
  if (system.includes("Name the kind of mistake"))
    return JSON.stringify({ kind: "unverified-claim", suggested: "", description: "" });
  return "{}";
})()`;

function events(home: string, type: string): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

test("the rating handler judges all three questions through judge(), off by default, with the same stored kind", async () => {
  const home = freshTestDir(import.meta.file);
  writeFakeBin(home, "claude", claudeReplying(ANSWER_BY_SYSTEM_PROMPT));
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAL_HOME: home,
    PAL_AGENT: "claude",
    PATH: `${home}${delimiter}${process.env.PATH ?? ""}`,
  };
  for (const key of [
    "PAL_INFERENCE_DISABLED",
    "PAL_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "PAL_TYPESAFE_API_KEY",
    "TYPESAFE_API_KEY",
    "CLAUDECODE",
    SPAWN_GUARD_ENV.SENTINEL,
    SPAWN_GUARD_ENV.DEPTH,
  ])
    delete env[key];
  const b64 = (t: string) => Buffer.from(t).toString("base64");
  const child = Bun.spawn(
    [
      "bun",
      RATING,
      "--sentiment",
      "s1",
      b64("ci is not green btw"),
      b64("CI is green."),
      new Date().toISOString(),
    ],
    { env, stdout: "ignore", stderr: "ignore" }
  );
  await child.exited;

  const turnsDir = resolve(home, "memory", "adaptation");
  const turn = readdirSync(turnsDir)
    .filter((f) => f.startsWith("turns-"))
    .flatMap((f) => readFileSync(resolve(turnsDir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))[0];
  expect(turn.correctionKind.kind).toBe("unverified-claim");

  const judged = events(home, "judge_call");
  expect(judged.length).toBe(3);
  expect(new Set(judged.map((e) => e.caller)).size).toBe(3);
  for (const e of judged) {
    expect(e.mode).toBe("off");
    expect(e.route).toBe("fallback");
  }
  expect(events(home, "inference_call").length).toBe(3);
});

test("labelWithInference judges through judge() and still returns the fallback's kind", async () => {
  const home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
  delete process.env.PAL_INFERENCE_DISABLED;
  delete process.env.PAL_TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  writeFakeBin(home, "claude", claudeReplying(ANSWER_BY_SYSTEM_PROMPT));
  prependPath(home);
  const { labelWithInference } = await import("../src/hooks/lib/correction-backfill");
  const kind = await labelWithInference({
    replyEnd: "CI is green.",
    message: "ci is not green btw",
    issue: "Said CI was green",
  } as never);
  expect(kind).toEqual({ kind: "unverified-claim", suggested: "", description: "" });
  const judged = events(home, "judge_call");
  expect(judged).toHaveLength(1);
  expect(judged[0]).toMatchObject({
    caller: "correction-kind",
    mode: "off",
    route: "fallback",
  });
  expect(backfillCorrectionKinds).toBeDefined();
});
