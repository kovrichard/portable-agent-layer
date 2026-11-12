/**
 * One anonymous POST per install per day, to count PAL users. Its id is apart
 * from machine.json, so the id that tags local records never leaves the machine.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getInstalledVersion, updateChannel } from "../handlers/update-check";
import { appendEvent, eventsSince, type LoggedEvent, logQuietly } from "./events";
import { logDebug, logError } from "./log";
import { palHome, palPkg } from "./paths";
import { telemetryEnabled } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 3000;
const HEARTBEAT_URL = "https://n8n.konvert7.com/webhook/pal-heartbeat";

interface Heartbeat {
  install_id: string;
  version: string;
  channel: string;
  os: string;
  arch: string;
  agents: string[];
}

interface TelemetryState {
  id: string;
  createdAt: string;
  attemptedAt?: string;
}

type Env = Record<string, string | undefined>;

function statePath(): string {
  return resolve(palHome(), "telemetry.json");
}

function readState(): TelemetryState | null {
  if (!existsSync(statePath())) return null;

  try {
    return JSON.parse(readFileSync(statePath(), "utf-8")) as TelemetryState;
  } catch {
    return null;
  }
}

function writeState(state: TelemetryState): TelemetryState {
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf-8");

  return state;
}

export function telemetryState(): TelemetryState {
  return (
    readState() ??
    writeState({ id: crypto.randomUUID(), createdAt: new Date().toISOString() })
  );
}

export function optOutReason(env: Env = process.env): string | null {
  if (!telemetryEnabled()) return "turned off in settings";

  if (env.DO_NOT_TRACK === "1") return "DO_NOT_TRACK is set";

  if (env.PAL_TELEMETRY_DISABLED === "1") return "PAL_TELEMETRY_DISABLED is set";

  if (env.PAL_TEST_SANDBOX === "1") return "test sandbox";

  if (env.CI) return "running in CI";

  return null;
}

export function heartbeatEndpoint(env: Env = process.env): string | null {
  return (env.PAL_TELEMETRY_URL ?? HEARTBEAT_URL) || null;
}

function sentWithinADay(state: TelemetryState | null, now: number): boolean {
  if (!state?.attemptedAt) return false;

  return now - new Date(state.attemptedAt).getTime() < DAY_MS;
}

export function heartbeatDue(env: Env = process.env, now: number = Date.now()): boolean {
  if (optOutReason(env) !== null || !heartbeatEndpoint(env)) return false;

  return !sentWithinADay(readState(), now);
}

function buildHeartbeat(agents: string[]): Heartbeat {
  return {
    install_id: telemetryState().id,
    version: getInstalledVersion(),
    channel: updateChannel(),
    os: process.platform,
    arch: process.arch,
    agents: [...agents].sort(),
  };
}

function logHeartbeat(fields: Record<string, unknown>): void {
  logQuietly("pal_heartbeat", () => appendEvent("pal_heartbeat", fields));
}

function stampAttempt(now: number): void {
  writeState({ ...telemetryState(), attemptedAt: new Date(now).toISOString() });
}

export type HeartbeatOutcome = "sent" | "failed" | "skipped";

async function post(url: string, payload: Heartbeat, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    return { outcome: response.ok ? "sent" : "failed", status: response.status } as const;
  } catch {
    return { outcome: "failed", status: null } as const;
  }
}

/** The attempt is stamped before the POST, so a send that fails waits until tomorrow. */
export async function sendHeartbeat(
  agents: string[],
  {
    env = process.env,
    fetchImpl = fetch,
    now = Date.now(),
  }: { env?: Env; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<HeartbeatOutcome> {
  const skipReason = optOutReason(env) ?? (heartbeatEndpoint(env) ? null : "no endpoint");
  if (skipReason) {
    logHeartbeat({ outcome: "skipped", skipReason });

    return "skipped";
  }
  stampAttempt(now);
  const payload = buildHeartbeat(agents);
  const { outcome, status } = await post(
    String(heartbeatEndpoint(env)),
    payload,
    fetchImpl
  );
  logHeartbeat({ outcome, payload, status });

  return outcome;
}

export function recentHeartbeats(days = 30): LoggedEvent[] {
  return eventsSince("pal_heartbeat", new Date(Date.now() - days * DAY_MS));
}

function sendCommand(): string[] {
  return [resolve(palPkg(), "src", "cli", "index.ts"), "cli", "telemetry", "send"];
}

function spawnHeartbeat(): void {
  const child = spawn("bun", sendCommand(), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  logDebug("telemetry", "detached heartbeat spawned");
}

/** Session start's whole cost when nothing is due: one file read. */
export function heartbeatOnStart(): void {
  try {
    if (heartbeatDue()) spawnHeartbeat();
  } catch (err) {
    logError("telemetry", err);
  }
}
