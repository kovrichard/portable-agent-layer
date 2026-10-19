import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { readEvents } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { freshTestDir } from "./lib/test-home";

const PLUGIN_ROOT = resolve(import.meta.dir, "../assets/plugins/dark-factory");
const BUILD_SOURCE = readFileSync(join(PLUGIN_ROOT, "workflows/build.js"), "utf8");
const TASK = "t1";
const AWKWARD_ROLE = 'wr\'iter "x" — ő $HOME `id`\nline two';

let home: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  env = { ...process.env, DARK_FACTORY_HOME: home };
});

const commandIn = (prompt: string) =>
  prompt
    .split(
      "exactly this command with the Bash tool and nothing else, with a 10 minute timeout:\n\n"
    )[1]
    ?.split("\n\nReturn its exit code")[0] ?? "";

function runShell(command: string) {
  const result = Bun.spawnSync(["sh", "-c", command], {
    env: env as Record<string, string>,
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

function runBuildWithoutRuntimeGlobals() {
  const commands: string[] = [];
  const prepared = {
    before: [AWKWARD_ROLE],
    category: "small",
    base: "main",
    branch: "b",
    worktree: "/w",
    taskDir: "/t",
    specPath: "/t/spec.md",
  };
  const agent = async (
    prompt: string,
    options: { agentType?: string; label?: string }
  ) => {
    if (options.agentType === "dark-factory:po") return { userQuestion: "which one?" };
    if (options.agentType) return { question: "which one?" };
    const command = commandIn(prompt);
    commands.push(command);
    if (options.label === "prepare")
      return { exitCode: 0, stdout: JSON.stringify(prepared) };
    if (options.label === "trace") return runShell(command);
    return { exitCode: 0, stdout: "" };
  };
  const sandbox = {
    args: { task: TASK, pluginRoot: PLUGIN_ROOT },
    phase: () => {},
    agent,
  };
  vm.createContext(sandbox);
  const source = BUILD_SOURCE.replace("export const meta", "const meta");
  const globalsPresent = vm.runInContext(
    "[typeof btoa, typeof atob, typeof Buffer]",
    sandbox
  );
  const finished = vm.runInContext(`(async () => {\n${source}\n})()`, sandbox);
  return { commands, globalsPresent, finished };
}

describe("build workflow trace delivery", () => {
  test("build.js refers to none of the runtime globals the Workflow sandbox lacks", () => {
    const referenced = ["btoa", "atob", "Buffer", "TextEncoder", "TextDecoder"].filter(
      (name) => new RegExp(`\\b${name}\\b`).test(BUILD_SOURCE)
    );
    expect(referenced).toEqual([]);
  });

  test("finish() issues trace, status and notify in order without btoa, atob or Buffer, and the trace lands in the event log", async () => {
    const { commands, globalsPresent, finished } = runBuildWithoutRuntimeGlobals();
    expect(globalsPresent).toEqual(["undefined", "undefined", "undefined"]);
    expect(await finished).toMatchObject({ task: TASK, status: "waiting" });
    const tail = commands.slice(-3);
    expect(tail[0]).toContain("task.mjs trace t1");
    expect(tail[1]).toContain("task.mjs status t1 waiting");
    expect(tail[2]).toContain("notify.mjs t1 waiting");
    const roleRuns = readEvents(env).filter(
      (event: { event: string }) => event.event === "role_run"
    );
    expect(roleRuns).toEqual([
      expect.objectContaining({ task: TASK, role: AWKWARD_ROLE }),
    ]);
  });

  test("quotes, dollar signs, newlines and non-Latin-1 text in a trace field arrive unchanged", async () => {
    const { finished } = runBuildWithoutRuntimeGlobals();
    await finished;
    const events = readEvents(env).filter(
      (event: { task?: string }) => event.task === TASK
    );
    const questions = events.filter(
      (event: { event: string }) => event.event === "po_question"
    );
    expect(questions).toEqual([
      expect.objectContaining({ role: AWKWARD_ROLE, toUser: true }),
    ]);
  });
});
