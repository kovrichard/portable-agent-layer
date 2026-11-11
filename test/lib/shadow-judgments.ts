/**
 * Shared setup for the shadow-judgment caller tests: a home with a fake `claude`
 * binary, `systemOne` settings, a fake System One adapter and the event reader.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JUDGE_ADAPTERS } from "../../src/hooks/lib/judge";
import type {
  JudgeAdapter,
  JudgeAnswers,
  JudgeQuestions,
  JudgeState,
} from "../../src/hooks/lib/judgment";
import { reload } from "../../src/hooks/lib/settings";
import { SPAWN_GUARD_ENV } from "../../src/hooks/lib/spawn-guard";
import { claudeReplying, prependPath, writeFakeBin } from "../fixtures/fake-bin";
import { freshTestDir } from "./test-home";

const ORIGINAL_PATH = process.env.PATH;

/** A fresh PAL home whose `claude` replies with `reply` (a string, or undefined to fail). */
export function modelHome(file: string, reply: string | undefined): string {
  process.env.PATH = ORIGINAL_PATH;
  const home = freshTestDir(file);
  process.env.PAL_HOME = home;
  process.env.PAL_AGENT = "claude";
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
    delete process.env[key];
  delete JUDGE_ADAPTERS.fake;
  const bin = freshTestDir(file);
  writeFakeBin(
    bin,
    "claude",
    reply === undefined ? "process.exit(1);\n" : claudeReplying(JSON.stringify(reply))
  );
  prependPath(bin);
  setSystemOne(home, undefined);
  return home;
}

export function setSystemOne(
  home: string,
  systemOne: Record<string, unknown> | undefined
) {
  mkdirSync(resolve(home, "memory"), { recursive: true });
  writeFileSync(
    resolve(home, "memory", "pal-settings.json"),
    JSON.stringify(systemOne ? { systemOne } : {})
  );
  reload();
}

export interface LoggedEvent {
  type: string;
  caller?: string;
  tier?: string;
  mode?: string;
  route?: string;
  fallbackAnswers?: unknown;
  systemOneAnswers?: unknown;
}

export function eventsOf(home: string, type: string): LoggedEvent[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);
}

export interface Asked {
  state: JudgeState;
  questions: JudgeQuestions;
}

/** Registers provider `fake`; it records what it is asked and answers `answers`. */
export function fakeAdapter(answers: JudgeAnswers): { asked: Asked[] } {
  const asked: Asked[] = [];
  const adapter: JudgeAdapter = {
    defaultModel: "fake-1",
    keyNames: [],
    ask: async (input) => {
      asked.push({ state: input.state, questions: input.questions });
      return { answers, inputTokens: 5 };
    },
  };
  JUDGE_ADAPTERS.fake = adapter;
  return { asked };
}

export function shadowOn(home: string, caller: string, mode = "shadow") {
  setSystemOne(home, { provider: "fake", callers: { [caller]: mode } });
}
