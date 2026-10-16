import { expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { claudeReplying, writeFakeBin } from "./fixtures/fake-bin";
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

const PRAISING = `(() => {
  const args = Bun.argv;
  const system = require("node:fs").readFileSync(args[args.indexOf("--system-prompt-file") + 1], "utf-8");
  if (system.startsWith("You classify how a user reacted"))
    return JSON.stringify({ reaction: "praised", issue: "" });
  if (system.startsWith("The user praised"))
    return JSON.stringify({ repeatable: true, when: "the user counter-proposes", steering: "Argue again with the reason", explicit: true });
  return "{}";
})()`;

function childEnv(home: string): Record<string, string | undefined> {
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
    "CLAUDECODE",
    SPAWN_GUARD_ENV.SENTINEL,
    SPAWN_GUARD_ENV.DEPTH,
  ])
    delete env[key];
  return env;
}

function storedTurns(home: string) {
  const dir = resolve(home, "memory", "adaptation");
  return readdirSync(dir)
    .filter((file) => file.startsWith("turns-"))
    .flatMap((file) => readFileSync(resolve(dir, file), "utf-8").trim().split("\n"))
    .map((line) => JSON.parse(line));
}

test("a confirmed correction is stored with its kind and the kind-set version", async () => {
  const home = freshTestDir(import.meta.file);
  writeFakeBin(home, "claude", claudeReplying(ANSWER_BY_SYSTEM_PROMPT));
  const b64 = (text: string) => Buffer.from(text).toString("base64");
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
    { env: childEnv(home), stdout: "ignore", stderr: "ignore" }
  );
  await child.exited;

  const [turn] = storedTurns(home);
  expect(turn.confirmed).toBe(true);
  expect(turn.correctionKind).toEqual({
    kind: "unverified-claim",
    suggested: "",
    description: "",
    version: 2,
  });
});

test("praise is stored with the behavior it points at", async () => {
  const home = freshTestDir(import.meta.file);
  writeFakeBin(home, "claude", claudeReplying(PRAISING));
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  const child = Bun.spawn(
    [
      "bun",
      RATING,
      "--sentiment",
      "s1",
      b64("love the pushback, keep this up"),
      b64("Upkeep is still safer."),
      new Date().toISOString(),
    ],
    { env: childEnv(home), stdout: "ignore", stderr: "ignore" }
  );
  await child.exited;

  const [turn] = storedTurns(home);
  expect(turn.reaction).toBe("praised");
  expect(turn.praisedBehavior).toEqual({
    behavior: {
      when: "the user counter-proposes",
      steering: "Argue again with the reason",
    },
    explicit: true,
  });
  const rules = JSON.parse(
    readFileSync(resolve(home, "memory", "adaptation", "rules.json"), "utf-8")
  );
  expect(rules).toMatchObject([
    {
      status: "draft",
      polarity: "reinforce",
      when: "the user counter-proposes",
      evidence: ['Asked to keep it: "love the pushback, keep this up"'],
    },
  ]);
});
