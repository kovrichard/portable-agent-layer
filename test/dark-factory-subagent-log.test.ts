import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskDir, writeTask } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { recordSubagentStop } from "../assets/plugins/dark-factory/scripts/subagent-stop.mjs";
import {
  newTask,
  recordPoHandover,
  recordReview,
  recordTest,
} from "../assets/plugins/dark-factory/scripts/task.mjs";
import {
  eventsNamedIn,
  type FactoryEnv,
  freshFactoryHome,
  NOW,
} from "./lib/dark-factory-scripts-fixture";

let home: string;
let env: FactoryEnv;
let id: string;
let worktree: string;

beforeEach(() => {
  ({ home, env } = freshFactoryHome(import.meta.file));
  delete env.DARK_FACTORY_ROLE;
  ({ id } = newTask({ title: "Fix login", repo: "/repo", category: "bug" }, env, NOW));
  worktree = join(home, "worktrees", id);
  mkdirSync(worktree, { recursive: true });
  const task = JSON.parse(readFileSync(join(taskDir(id, env), "task.json"), "utf8"));
  writeTask({ ...task, worktree }, env);
});

const eventsNamed = (name: string) => eventsNamedIn(env, name);

const REPLY = "Implemented the change; the gate passes.";

function assistantLine(
  id: string,
  ts: string,
  usage: Record<string, number>,
  text = "Reading the plan."
) {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { id, model: "claude-haiku-5-5", usage, content: [{ type: "text", text }] },
  });
}

function transcript() {
  const file = join(home, "agent.jsonl");
  const first = {
    input_tokens: 2,
    output_tokens: 100,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 5000,
  };
  const second = {
    input_tokens: 3,
    output_tokens: 50,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 200,
  };
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "user", timestamp: "2026-11-08T08:00:00.000Z" }),
      assistantLine("msg_1", "2026-11-08T08:00:01.000Z", first),
      assistantLine("msg_1", "2026-11-08T08:00:01.500Z", first),
      assistantLine("msg_2", "2026-11-08T08:00:04.000Z", second, REPLY),
    ].join("\n")
  );

  return file;
}

function stopInput(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "SubagentStop",
    session_id: "parent-session",
    agent_id: "a123",
    agent_type: "dark-factory:code-writer",
    agent_transcript_path: transcript(),
    last_assistant_message: REPLY,
    cwd: worktree,
    ...overrides,
  };
}

describe("a factory subagent that stops", () => {
  test("is logged as role_finished with its tokens counted once per message", () => {
    recordSubagentStop(stopInput(), env);
    expect(eventsNamed("role_finished")).toEqual([
      expect.objectContaining({
        task: id,
        role: "code-writer",
        model: "claude-haiku-5-5",
        inputTokens: 5,
        outputTokens: 150,
        cacheReadTokens: 5000,
        cacheCreationTokens: 5200,
        turns: 2,
        durationMs: 4000,
        agentId: "a123",
        exitCode: 0,
        error: null,
      }),
    ]);
  });

  test("has its last message saved as the role's reply", () => {
    recordSubagentStop(stopInput(), env);
    const [finished] = eventsNamed("role_finished");
    const reply = JSON.parse(
      readFileSync(join(taskDir(id, env), finished.reply.file), "utf8")
    );
    expect(finished.reply.file).toBe(join("replies", "001-code-writer.json"));
    expect(reply).toEqual({
      result: "Implemented the change; the gate passes.",
      structured: null,
    });
  });

  test("whose reply is not yet in its transcript is waited for, up to the limit", () => {
    const started = Date.now();
    recordSubagentStop(
      stopInput({ last_assistant_message: "Not written yet." }),
      env,
      300
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(eventsNamed("role_finished")).toEqual([
      expect.objectContaining({ outputTokens: 150, turns: 2 }),
    ]);
  });

  test("whose reply is already in its transcript is logged without waiting", () => {
    const started = Date.now();
    recordSubagentStop(stopInput(), env, 2000);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("in a folder below the worktree is still matched to its task", () => {
    const below = join(worktree, "src");
    mkdirSync(below);
    recordSubagentStop(stopInput({ cwd: below }), env);
    expect(eventsNamed("role_finished")).toHaveLength(1);
  });
});

describe("a stopping subagent is not logged", () => {
  test("when it is not a factory role", () => {
    recordSubagentStop(stopInput({ agent_type: "Explore" }), env);
    expect(eventsNamed("role_finished")).toEqual([]);
  });

  test("when it runs inside a build.mjs role, which logs its own run", () => {
    recordSubagentStop(stopInput(), { ...env, DARK_FACTORY_ROLE: "code-writer" });
    expect(eventsNamed("role_finished")).toEqual([]);
  });

  test("when its folder is no task's worktree", () => {
    recordSubagentStop(stopInput({ cwd: home }), env);
    expect(eventsNamed("role_finished")).toEqual([]);
  });
});

describe("the PO's records for build-with-agents", () => {
  test("a handover with a model also logs the role run, as build.mjs does", () => {
    recordPoHandover(id, "reviewer", "pipeline", "Review the diff.", env, "sonnet");
    expect(eventsNamed("role_run")).toEqual([
      expect.objectContaining({ task: id, role: "reviewer", model: "sonnet" }),
    ]);
  });

  test("a handover without a model logs the role run with the default model", () => {
    recordPoHandover(id, "reviewer", "pipeline", "Review the diff.", env);
    expect(eventsNamed("role_run")).toEqual([
      expect.objectContaining({ role: "reviewer", model: "default" }),
    ]);
  });

  test("a review round is logged with its findings count", () => {
    recordReview(id, "2", "3", env);
    expect(eventsNamed("review")).toEqual([
      expect.objectContaining({ task: id, round: 2, findings: 3 }),
    ]);
  });

  test("a tester run is logged with its unmet criteria count", () => {
    recordTest(id, "1", env);
    expect(eventsNamed("test")).toEqual([
      expect.objectContaining({ task: id, unmet: 1 }),
    ]);
  });

  test("a count that is not a whole number is refused", () => {
    expect(() => recordReview(id, "1", "some", env)).toThrow(/whole number/);
    expect(eventsNamed("review")).toEqual([]);
  });
});
