import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");

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
