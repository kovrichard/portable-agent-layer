import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvent,
  readEvents,
  readTask,
  taskDir,
  writeTask,
} from "../../assets/plugins/dark-factory/scripts/lib.mjs";
import { rolesFor } from "../../assets/plugins/dark-factory/scripts/roles.mjs";
import { freshTestDir } from "./test-home";

export const TASK = "t1";
export const PR_URL = "https://github.com/o/r/pull/7";
export const SPEC = "# Add export\n\n## Goal\n\nExport.\n\n## Decisions\n\n- start\n";
export const TESTS_COMMAND = "run the tests";

export type RoleStep = {
  reply?: object;
  exit?: number;
  codes?: boolean;
  commits?: boolean;
  changes?: string[];
};

export type RoleCall = {
  role: string;
  model?: string;
  instructions?: string;
  resumeSessionId?: string;
};

type CheckResult = { exitCode: number; output: string };
type CiCheck = string | { name: string; link?: string };
type CiState = { state: string; failed: CiCheck[] };

type WorldOptions = {
  category?: string;
  config?: object;
  roles?: Record<string, RoleStep[]>;
  checks?: Record<string, (world: World) => CheckResult>;
  ci?: CiState[];
  ciError?: string;
  commitsAhead?: number;
  rerunFails?: boolean;
  headUnreadable?: boolean;
  gitHeadUnreadable?: boolean;
};

export type World = {
  env: Record<string, string>;
  worktree: string;
  coded: boolean;
  changedFiles: string[];
  roleCalls: RoleCall[];
  checkCommands: string[];
  pushes: number;
  ciReads: number;
  head: number;
  reruns: string[][];
  effects: Record<string, unknown>;
};

export const DEFAULT_CONFIG = {
  baseBranch: "canary",
  gate: [{ name: "tests", run: TESTS_COMMAND }],
};

const ROLE_DEFAULTS: Record<string, RoleStep> = {
  "code-writer": { codes: true },
  debugger: { codes: true },
  reviewer: { reply: { findings: [] } },
  tester: { reply: { criteria: [] } },
  po: { reply: { answer: "ok" } },
};

function testsCheck(world: World): CheckResult {
  return world.coded
    ? { exitCode: 0, output: " 3 pass" }
    : { exitCode: 1, output: " 1 pass\n 2 fail" };
}

function stepFor(options: WorldOptions, role: string, index: number): RoleStep {
  return {
    reply: { done: true, summary: "done" },
    ...ROLE_DEFAULTS[role],
    ...(options.roles?.[role]?.[index] ?? {}),
  };
}

function seedTask(env: Record<string, string>, category: string) {
  writeTask(
    { id: TASK, title: "Add export", repo: "/repo", category, status: "draft" },
    env
  );
  writeFileSync(join(taskDir(TASK, env), "spec.md"), SPEC);
}

function fakeRole(world: World, options: WorldOptions) {
  return (taskId: string, role: string, args: Omit<RoleCall, "role">) => {
    const index = world.roleCalls.filter((call) => call.role === role).length;
    world.roleCalls.push({ role, ...args });
    const step = stepFor(options, role, index);
    if (step.codes) world.coded = true;
    if (step.commits) world.head += 1;
    world.changedFiles.push(...(step.changes ?? []));
    const exitCode = step.exit ?? 0;
    if (role === "planner" && exitCode === 0) {
      writeFileSync(join(taskDir(taskId, world.env), "plan.md"), "plan\n");
    }
    const outcome = {
      task: taskId,
      role,
      exitCode,
      structured: exitCode === 0 ? step.reply : null,
      sessionId: args.resumeSessionId ?? `sess-${role}-${index + 1}`,
      error: exitCode === 0 ? null : `claude exited ${exitCode}`,
      costUsd: 0.25,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheCreationTokens: 20,
    };
    appendEvent({ event: "role_finished", ...outcome, structured: undefined }, world.env);
    return outcome;
  };
}

function fakePrepare(world: World, options: WorldOptions) {
  return (id: string, env: Record<string, string>) => {
    const task = readTask(id, env);
    const config = options.config ?? DEFAULT_CONFIG;
    writeTask(
      { ...task, base: "canary", worktree: world.worktree, status: "running", config },
      env
    );
    appendEvent({ event: "task_started", task: id, category: task.category }, env);
    return {
      worktree: world.worktree,
      branch: `factory/${id}`,
      base: "canary",
      config,
      category: task.category,
      before: rolesFor(task.category).before,
      taskDir: taskDir(id, env),
      specPath: join(taskDir(id, env), "spec.md"),
    };
  };
}

function runIdOf(check: CiCheck): string | undefined {
  return typeof check === "string"
    ? undefined
    : check.link?.match(/\/actions\/runs\/(\d+)/)?.[1];
}

function ciResult(entry: CiState) {
  const names = entry.failed.map((check) =>
    typeof check === "string" ? check : check.name
  );
  const runs = entry.failed.map(runIdOf).filter((id): id is string => Boolean(id));
  return { state: entry.state, failed: names, runs: [...new Set(runs)] };
}

function fakeCi(world: World, options: WorldOptions) {
  return () => {
    world.ciReads += 1;
    if (options.ciError) throw new Error(options.ciError);
    if (options.headUnreadable)
      throw new Error("could not read the worktree HEAD: fatal");
    const entry = options.ci?.[world.ciReads - 1] ??
      options.ci?.at(-1) ?? { state: "pass", failed: [] };
    return ciResult(entry);
  };
}

function fakeSpawnTool(world: World, options: WorldOptions) {
  return (command: string, args: string[]) => {
    if (command === "gh" && args[0] === "run" && args[1] === "rerun") {
      world.reruns.push(args);
      return { status: options.rerunFails ? 1 : 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return options.headUnreadable || options.gitHeadUnreadable
        ? { status: 128, stdout: "", stderr: "fatal" }
        : { status: 0, stdout: `sha-${world.head}\n`, stderr: "" };
    }
    return { status: 0, stdout: String(options.commitsAhead ?? 0), stderr: "" };
  };
}

function fakeShip(world: World) {
  return {
    sync: () => ({ rebased: false, conflict: false }),
    push: () => {
      world.pushes += 1;
      return { pushed: `factory/${TASK}` };
    },
    openPr: (id: string, env: Record<string, string>) => {
      writeTask({ ...readTask(id, env), pr: PR_URL }, env);
      return { pr: PR_URL };
    },
    markReady: (id: string, env: Record<string, string>) => {
      appendEvent({ event: "pr_ready", task: id, pr: PR_URL }, env);
      return { ready: PR_URL };
    },
  };
}

export function buildWorld(testFile: string, options: WorldOptions = {}): World {
  const root = freshTestDir(testFile);
  const env = { DARK_FACTORY_HOME: join(root, "factory"), HOME: root };
  const world: World = {
    env,
    worktree: join(root, "worktree"),
    coded: false,
    changedFiles: [],
    roleCalls: [],
    checkCommands: [],
    pushes: 0,
    ciReads: 0,
    head: 0,
    reruns: [],
    effects: {},
  };
  mkdirSync(world.worktree, { recursive: true });
  seedTask(env, options.category ?? "small");
  const checks: Record<string, (world: World) => CheckResult> = {
    [TESTS_COMMAND]: testsCheck,
    ...options.checks,
  };
  world.effects = {
    runRoleHeadless: fakeRole(world, options),
    runCheck: (command: string) => {
      world.checkCommands.push(command);
      return checks[command]?.(world) ?? { exitCode: 0, output: "" };
    },
    spawnTool: fakeSpawnTool(world, options),
    changedFilesSince: () => [...world.changedFiles],
    prepare: fakePrepare(world, options),
    waitForCi: fakeCi(world, options),
    startCoach: (id: string, status: string, env: Record<string, string>) =>
      appendEvent({ event: "coach_handed", task: id, status }, env),
    ...fakeShip(world),
  };
  return world;
}

export function eventsOf(world: World): Record<string, unknown>[] {
  return readEvents(world.env) as Record<string, unknown>[];
}

export function eventsNamed(world: World, name: string) {
  return eventsOf(world).filter((event) => event.event === name);
}

export function storedTask(world: World) {
  return readTask(TASK, world.env);
}
