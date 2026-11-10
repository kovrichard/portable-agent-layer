import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
const LIB = resolve(import.meta.dir, "../src/hooks/lib/telemetry.ts");

let home: string;
let received: unknown[];
let server: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => {
  server?.stop(true);
  home = freshTestDir(import.meta.file);
  mkdirSync(resolve(home, "memory"), { recursive: true });
  received = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      received.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });
});

function unsandboxedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAL_HOME: home,
    PAL_PKG: resolve(import.meta.dir, ".."),
    PAL_SKIP_DOCTOR: "1",
    PAL_TELEMETRY_URL: `http://127.0.0.1:${server?.port}/beat`,
  };
  for (const name of ["PAL_TEST_SANDBOX", "CI", "DO_NOT_TRACK", "PAL_TELEMETRY_DISABLED"])
    delete env[name];
  return env;
}

function loggedPayloads(): unknown[] {
  const month = new Date().toISOString().slice(0, 7);
  return readFileSync(resolve(home, "memory", "events", `${month}.jsonl`), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "pal_heartbeat")
    .map((event) => event.payload);
}

test("pal cli telemetry send posts the heartbeat and logs exactly what it posted", async () => {
  const child = Bun.spawn(["bun", CLI, "cli", "telemetry", "send"], {
    env: unsandboxedEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain("sent");
  expect(received).toHaveLength(1);
  expect(loggedPayloads()).toEqual(received);
});

async function receivedWithin(ms: number): Promise<unknown[]> {
  const deadline = Date.now() + ms;
  while (received.length === 0 && Date.now() < deadline) await Bun.sleep(100);
  return received;
}

function startSession(env: Record<string, string | undefined>) {
  const script = `import { heartbeatOnStart } from ${JSON.stringify(LIB)}; heartbeatOnStart();`;
  return Bun.spawn(["bun", "-e", script], { env, stdout: "ignore", stderr: "ignore" });
}

function spawnedHeartbeats(): number {
  const log = resolve(home, "debug", "debug.log");
  if (!existsSync(log)) return 0;
  return readFileSync(log, "utf-8").split("detached heartbeat spawned").length - 1;
}

function enableDebugLog() {
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  writeFileSync(resolve(home, "memory", "state", "debug-enabled"), "");
}

test("session start sends a due heartbeat in the background", async () => {
  enableDebugLog();
  expect(await startSession(unsandboxedEnv()).exited).toBe(0);
  expect(spawnedHeartbeats()).toBe(1);
  expect(await receivedWithin(10_000)).toHaveLength(1);
});

test("session start spawns no heartbeat when it is not due", async () => {
  enableDebugLog();
  expect(await startSession({ ...unsandboxedEnv(), DO_NOT_TRACK: "1" }).exited).toBe(0);
  expect(spawnedHeartbeats()).toBe(0);
  expect(received).toEqual([]);
});
