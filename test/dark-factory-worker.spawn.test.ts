import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { readEvents, writeTask } from "../assets/plugins/dark-factory/scripts/lib.mjs";
import { writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(120_000);

const BUILD_SCRIPT = resolve(
  import.meta.dir,
  "../assets/plugins/dark-factory/scripts/build.mjs"
);
const TASK = "t1";
const PR_URL = "https://github.com/o/r/pull/7";
const TESTS_CHECK =
  "if [ -f feature.txt ]; then echo ' 3 pass'; exit 0; fi; echo ' 1 pass'; echo ' 2 fail'; exit 1";
const SPEC = "# Add export\n\n## Goal\n\nExport.\n\n## Decisions\n\n- start\n";
const POLL_MS = 50;
const SYSTEMD_PROBE = ["--user", "--scope", "--collect", "--quiet", "true"];

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

type Root = {
  root: string;
  factory: string;
  repo: string;
  remote: string;
  bin: string;
  hold: string;
  entered: string;
};

let ctx: Root;

const FAKE_CLAUDE = `
const fs = require("node:fs");
const cp = require("node:child_process");
const argv = process.argv.slice(2);
const valueOf = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const role = valueOf("--agent").replace("dark-factory:", "");
await Bun.stdin.text();
const mode = process.env.FAKE_MODE ?? "ready";
let reply = { done: true, summary: "done" };
if (role === "reviewer") reply = { findings: [] };
if (role === "po") reply = mode === "waiting" ? { userQuestion: "which db?" } : { answer: "ok" };
if (role === "coach") reply = { findings: [], updates: [] };
if (role === "code-writer" && mode === "waiting") reply = { done: false, summary: "", question: "which db?" };
if (role === "code-writer") {
  fs.writeFileSync(process.env.FAKE_ENTERED, "1");
  while (fs.existsSync(process.env.FAKE_HOLD)) await Bun.sleep(25);
  if (mode === "ready") {
    fs.writeFileSync("feature.txt", "code");
    cp.spawnSync("git", ["add", "-A"]);
    cp.spawnSync("git", ["commit", "-q", "-m", "feat: work"]);
  }
}
process.stdout.write(JSON.stringify({
  type: "result", subtype: "success", is_error: false, result: "",
  session_id: valueOf("--resume") ?? "sess-" + role, total_cost_usd: 0.25, num_turns: 1, duration_ms: 5,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 },
  structured_output: reply,
}));
`;

const FAKE_GH = `
const args = process.argv.slice(2);
const [group, action] = args;
if (group === "pr" && action === "list") process.stdout.write("[]");
if (group === "pr" && action === "create") process.stdout.write("${PR_URL}\\n");
if (group === "pr" && action === "checks") process.stdout.write(JSON.stringify([{ name: "ci", bucket: "pass" }]));
`;

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

function buildEnv(mode = "ready"): Record<string, string> {
  return {
    ...process.env,
    ...GIT_ENV,
    DARK_FACTORY_HOME: ctx.factory,
    DARK_FACTORY_NOTIFY: process.platform === "win32" ? "exit 0" : "cat > /dev/null",
    FAKE_MODE: mode,
    FAKE_HOLD: ctx.hold,
    FAKE_ENTERED: ctx.entered,
    PATH: [ctx.bin, process.env.PATH ?? ""].join(delimiter),
  } as Record<string, string>;
}

function seed() {
  mkdirSync(ctx.repo, { recursive: true });
  git(ctx.root, "init", "-q", "--bare", "-b", "canary", ctx.remote);
  git(ctx.repo, "init", "-q", "-b", "canary");
  writeFileSync(
    join(ctx.repo, ".dark-factory.json"),
    JSON.stringify({ baseBranch: "canary", gate: [{ name: "tests", run: TESTS_CHECK }] })
  );
  writeFileSync(join(ctx.repo, "README.md"), "repo\n");
  git(ctx.repo, "add", "-A");
  git(ctx.repo, "commit", "-q", "-m", "init");
  git(ctx.repo, "remote", "add", "origin", ctx.remote);
  git(ctx.repo, "push", "-q", "origin", "canary");
  mkdirSync(ctx.bin, { recursive: true });
  writeFakeBin(ctx.bin, "claude", FAKE_CLAUDE);
  writeFakeBin(ctx.bin, "gh", FAKE_GH);
  writeTask(
    { id: TASK, title: "Add export", repo: ctx.repo, category: "small", status: "draft" },
    buildEnv()
  );
  writeFileSync(join(taskFolder(), "spec.md"), SPEC);
}

const taskFolder = () => join(ctx.factory, "tasks", TASK);
const resultFile = () => join(taskFolder(), "result.json");
const lockFile = () => join(taskFolder(), "build.lock");
const logFile = () => join(taskFolder(), "build.log");
const holdWorker = () => writeFileSync(ctx.hold, "1");
const releaseWorker = () => removeOnceReleased(ctx.hold);
const events = () =>
  readEvents({ DARK_FACTORY_HOME: ctx.factory }) as Record<string, unknown>[];
const eventsNamed = (name: string) => events().filter((event) => event.event === name);
const storedStatus = () =>
  JSON.parse(readFileSync(join(taskFolder(), "task.json"), "utf8")).status;

type Waiter = {
  child: ChildProcess;
  stdout: () => string;
  exited: Promise<number | null>;
};

function startWaiter(mode = "ready"): Waiter {
  const child = spawn(process.execPath, [BUILD_SCRIPT, TASK], {
    env: buildEnv(mode),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (chunk) => {
    out += chunk;
  });
  const exited = new Promise<number | null>((done) => child.on("close", done));
  return { child, stdout: () => out, exited };
}

async function until(condition: () => boolean, what: string, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(POLL_MS);
  }
}

const workerEntered = () => existsSync(ctx.entered);
const lockPid = () => Number(readFileSync(lockFile(), "utf8").trim());
const printed = (waiter: Waiter) => JSON.parse(waiter.stdout().trim());

const hasSystemd =
  process.platform === "linux" &&
  spawnSync("systemd-run", SYSTEMD_PROBE, { stdio: "ignore" }).status === 0;

const cgroupOf = (pid: number) => readFileSync(`/proc/${pid}/cgroup`, "utf8").trim();

beforeEach(() => {
  const root = freshTestDir(import.meta.file);
  ctx = {
    root,
    factory: join(root, "factory"),
    repo: join(root, "repo"),
    remote: join(root, "remote.git"),
    bin: join(root, "bin"),
    hold: join(root, "hold"),
    entered: join(root, "entered"),
  };
  mkdirSync(ctx.factory, { recursive: true });
  seed();
});

describe("the waiter prints what the worker decided", () => {
  test("a ready build prints one JSON line and exits 0", async () => {
    const waiter = startWaiter("ready");
    expect(await waiter.exited).toBe(0);
    expect(waiter.stdout().trim().split("\n")).toHaveLength(1);
    expect(printed(waiter)).toEqual({
      task: TASK,
      status: "ready",
      message: `Ready for your review: ${PR_URL}`,
      pr: PR_URL,
    });
  });

  test("a stuck build prints stuck and exits 1", async () => {
    const waiter = startWaiter("stuck");
    expect(await waiter.exited).toBe(1);
    expect(printed(waiter)).toMatchObject({ task: TASK, status: "stuck", pr: null });
  });

  test("a build that needs the user prints waiting and exits 3", async () => {
    const waiter = startWaiter("waiting");
    expect(await waiter.exited).toBe(3);
    expect(printed(waiter)).toMatchObject({
      task: TASK,
      status: "waiting",
      message: "which db?",
    });
  });
});

describe("the worker outlives the waiter", () => {
  test("killing the waiter does not stop the worker, which still writes its result", async () => {
    holdWorker();
    const waiter = startWaiter();
    await until(workerEntered, "the worker to reach the code writer");
    waiter.child.kill("SIGKILL");
    await waiter.exited;
    releaseWorker();
    await until(() => existsSync(resultFile()), "result.json");
    expect(JSON.parse(readFileSync(resultFile(), "utf8"))).toMatchObject({
      task: TASK,
      status: "ready",
      pr: PR_URL,
    });
  });

  test.skipIf(!hasSystemd)(
    "on Linux with systemd the worker runs in its own cgroup scope",
    async () => {
      holdWorker();
      const waiter = startWaiter();
      await until(workerEntered, "the worker to reach the code writer");
      const waiterCgroup = cgroupOf(waiter.child.pid as number);
      expect(cgroupOf(lockPid())).not.toBe(waiterCgroup);
      expect(eventsNamed("run_started")[0]).toMatchObject({
        task: TASK,
        isolation: "systemd-scope",
      });
      releaseWorker();
      await waiter.exited;
    }
  );

  test.skipIf(hasSystemd)(
    "without a systemd scope the worker is a plain detached child",
    async () => {
      const waiter = startWaiter();
      await waiter.exited;
      expect(eventsNamed("run_started")[0]).toMatchObject({
        task: TASK,
        isolation: "detached",
      });
    }
  );
});

describe("what the worker leaves in the task folder", () => {
  test("result.json holds the printed result and build.log exists", async () => {
    const waiter = startWaiter();
    await waiter.exited;
    expect(JSON.parse(readFileSync(resultFile(), "utf8"))).toEqual(printed(waiter));
    expect(existsSync(logFile())).toBe(true);
  });

  test("a result.json from an earlier run is never printed", async () => {
    writeFileSync(
      resultFile(),
      JSON.stringify({ task: TASK, status: "waiting", message: "stale", pr: null })
    );
    const waiter = startWaiter();
    expect(await waiter.exited).toBe(0);
    expect(printed(waiter).status).toBe("ready");
  });
});

describe("one worker per task", () => {
  test("a second build while the worker is alive waits for it and starts no second one", async () => {
    holdWorker();
    const first = startWaiter();
    await until(workerEntered, "the worker to reach the code writer");
    expect(lockPid()).toBeGreaterThan(0);
    const second = startWaiter();
    await Bun.sleep(1500);
    releaseWorker();
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    expect(printed(second)).toEqual(printed(first));
    expect(eventsNamed("run_started")).toHaveLength(1);
  });
});

describe("a worker that dies", () => {
  test("the waiter prints stuck, says how to resume, marks the task and frees the lock", async () => {
    holdWorker();
    const waiter = startWaiter();
    await until(workerEntered, "the worker to reach the code writer");
    process.kill(lockPid(), "SIGKILL");
    expect(await waiter.exited).toBe(1);
    const result = printed(waiter);
    expect(result.status).toBe("stuck");
    expect(result.message).toMatch(/worker died/i);
    expect(result.message).toMatch(/same command/i);
    expect(storedStatus()).toBe("stuck");
    expect(existsSync(lockFile())).toBe(false);
    releaseWorker();
  });
});
