/**
 * pal cli server — start, stop and inspect the local ledger page.
 *
 * The server itself is src/tools/ledger/server.ts, run detached so it
 * outlives the shell that started it. This file only owns the lifecycle:
 * spawning, waiting for it to answer, remembering its pid, and killing it.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnDetachedInference } from "../hooks/lib/detached-inference";
import { paths } from "../hooks/lib/paths";
import { DEFAULT_PORT, LOOPBACK, type ServerStatus } from "../tools/ledger/server";

interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
}

const SERVER_SCRIPT = resolve(import.meta.dir, "..", "tools", "ledger", "server.ts");
const STARTUP_TIMEOUT_MS = 3000;
const PROBE_TIMEOUT_MS = 500;

export async function runServer(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return cmdStart(rest);
    case "stop":
      return cmdStop();
    case "status":
      return cmdStatus();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      showHelp();
      return 0;
    default:
      console.error(`Unknown subcommand: ${sub}\n`);
      showHelp();
      return 1;
  }
}

function showHelp(): void {
  console.log(`
  Usage:
    pal cli server <subcommand>

  Subcommands:
    start [--port <n>]         Start the ledger page in the background (default port ${DEFAULT_PORT})
    stop                       Stop it
    status                     Show whether it is running, and where

  The page listens on ${LOOPBACK} only.
`);
}

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

function parsePort(args: string[]): number | string {
  const { values } = parseArgs({ args, options: { port: { type: "string" } } });
  if (values.port === undefined) return DEFAULT_PORT;
  const port = Number(values.port);
  return Number.isInteger(port) && port > 0 && port < 65536
    ? port
    : `--port must be a port number, got ${values.port}`;
}

async function cmdStart(args: string[]): Promise<number> {
  const port = parsePort(args);
  if (typeof port === "string") return fail(port);

  const running = await runningServer();
  if (running) {
    console.log(`Already running at ${url(running.port)} (pid ${running.pid})`);
    return 0;
  }

  spawnDetachedInference(SERVER_SCRIPT, [`--port=${port}`], "ledger-server");
  const status = await waitUntilAnswering(port);
  if (!status)
    return fail(
      `The ledger page did not answer on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s. Is the port free?`
    );

  writeState({ pid: status.pid, port, startedAt: status.startedAt });
  console.log(url(port));
  return 0;
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
