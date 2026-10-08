/**
 * pal cli server — start, stop and inspect the local control room.
 *
 * The server itself is src/tools/control-room/server.ts, run detached so it
 * outlives the shell that started it. This file only owns the lifecycle:
 * spawning, waiting for it to answer, remembering its pid, and killing it.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnDetachedInference } from "../hooks/lib/detached-inference";
import { paths } from "../hooks/lib/paths";
import type { ServerStatus } from "../tools/control-room/server";
import { DEFAULT_PORT, LOOPBACK } from "../tools/control-room/server-config";
import { BUILD_COMMAND, buildPage, isBuilt } from "../tools/control-room/static";
import { group, leaf, UsageError } from "../tools/lib/command";

interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
}

const SERVER_SCRIPT = resolve(
  import.meta.dir,
  "..",
  "tools",
  "control-room",
  "server.ts"
);
const STARTUP_TIMEOUT_MS = 3000;
const PROBE_TIMEOUT_MS = 500;

export const serverCommand = group({
  summary: "Start, stop and inspect the local control room",
  details: `The page listens on ${LOOPBACK} only.`,
  commands: {
    start: leaf({
      summary: "Start the control room in the background",
      options: {
        port: {
          type: "string",
          value: "<n>",
          description: `Port to listen on (default ${DEFAULT_PORT})`,
        },
      },
      run: ({ values }) => cmdStart(parsePort(values.port)),
    }),
    stop: leaf({ summary: "Stop it", run: cmdStop }),
    restart: leaf({
      summary: "Replace a running one — the API only changes when the process does",
      run: cmdRestart,
    }),
    status: leaf({ summary: "Show whether it is running, and where", run: cmdStatus }),
  },
});

function url(port: number): string {
  return `http://${LOOPBACK}:${port}/`;
}

function readState(): ServerState | null {
  const file = paths.serverState();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ServerState;
  } catch {
    return null;
  }
}

function writeState(state: ServerState): void {
  writeFileSync(paths.serverState(), JSON.stringify(state, null, 2), "utf-8");
}

function clearState(): void {
  const file = paths.serverState();
  if (existsSync(file)) unlinkSync(file);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probe(port: number): Promise<ServerStatus | null> {
  try {
    const res = await fetch(`${url(port)}api/status`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as ServerStatus) : null;
  } catch {
    return null;
  }
}

async function waitUntilAnswering(port: number): Promise<ServerStatus | null> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await probe(port);
    if (status) return status;
    await Bun.sleep(100);
  }
  return null;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  throw new UsageError(`--port must be a port number, got ${value}`);
}

async function cmdStart(port: number): Promise<number> {
  const running = await runningServer();
  if (running) {
    console.log(`Already running at ${url(running.port)} (pid ${running.pid})`);
    return 0;
  }

  if (!isBuilt() && !buildPage()) {
    return fail(
      `The control room's page is not built and could not be. Run: ${BUILD_COMMAND}`
    );
  }

  spawnDetachedInference(SERVER_SCRIPT, [`--port=${port}`], "control-room");
  const status = await waitUntilAnswering(port);
  if (!status)
    return fail(
      `The control room did not answer on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s. Is the port free?`
    );

  writeState({ pid: status.pid, port, startedAt: status.startedAt });
  console.log(url(port));
  return 0;
}

/**
 * The page is read off disk per request, so a rebuilt dist reaches the browser
 * on the next reload — but the API routes are the running process's own code,
 * and those only change when the process does.
 */
async function cmdRestart(): Promise<number> {
  const running = await runningServer();
  if (!running) {
    console.log("Not running — nothing to restart. Use `start`.");
    return 0;
  }
  await cmdStop();
  return cmdStart(running.port);
}

/**
 * Used by `pal cli install`: an install that leaves an old build answering on
 * the port has not finished. A server nobody started stays unstarted.
 */
export async function restartIfRunning(): Promise<boolean> {
  return (await runningServer()) !== null && (await cmdRestart()) === 0;
}

/** The state file is a claim; the process answering on that port is the fact. */
async function runningServer(): Promise<ServerState | null> {
  const state = readState();
  if (!state || !alive(state.pid)) return null;
  return (await probe(state.port)) ? state : null;
}

async function cmdStop(): Promise<number> {
  const state = readState();
  if (!state) {
    console.log("Not running.");
    return 0;
  }
  if (alive(state.pid)) {
    process.kill(state.pid);
    console.log(`Stopped pid ${state.pid}.`);
  } else {
    console.log(`Pid ${state.pid} was already gone; cleared the stale record.`);
  }
  clearState();
  return 0;
}

async function cmdStatus(): Promise<number> {
  const state = readState();
  if (!state) {
    console.log("Not running.");
    return 1;
  }
  const status = alive(state.pid) ? await probe(state.port) : null;
  if (!status) {
    console.log(
      `Not running (stale record for pid ${state.pid}; run \`pal cli server stop\`).`
    );
    return 1;
  }
  console.log(`
  ${url(status.port)}
  pid          ${status.pid}
  started      ${status.startedAt}
  ledger       ${status.ledgerFiles} file(s)
  machine      ${status.machine}
`);
  return 0;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}
