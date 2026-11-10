/**
 * One `hook_run` event per PAL hook process: which hook, for which event and
 * session, its exit code, and the milliseconds since the process started.
 */

import { basename } from "node:path";
import { appendEvent, logQuietly } from "./events";

const run: { event: string | null; session: string | null } = {
  event: null,
  session: null,
};

function firstString(payload: Record<string, unknown>, names: string[]): string | null {
  const value = names.map((n) => payload[n]).find((v) => typeof v === "string" && v);
  return (value as string | undefined) ?? null;
}

export function noteHookPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const fields = payload as Record<string, unknown>;
  run.event = firstString(fields, ["hook_event_name", "hookEventName"]);
  run.session = firstString(fields, ["session_id", "conversation_id", "sessionId"]);
}

export function noteHookPayloadText(text: string): void {
  try {
    noteHookPayload(JSON.parse(text));
  } catch {
    noteHookPayload(null);
  }
}

function hookName(entry: string): string {
  return basename(entry).replace(/\.[cm]?[jt]s$/, "");
}

export function recordHookRunOnExit(entry: string = process.argv[1] ?? "unknown"): void {
  process.once("exit", (exitCode) => {
    const durationMs = Math.round(performance.now());
    logQuietly("hook_run", () =>
      appendEvent(
        "hook_run",
        { hook: hookName(entry), event: run.event, durationMs, exitCode },
        { session: run.session, project: null }
      )
    );
  });
}
