/**
 * When the agent waits on the user: a permission prompt, or a notification that
 * it needs them.
 */

import { normalizeToolUse } from "./agent";
import { appendEvent, logQuietly } from "./events";
import { hookSessionId } from "./hook-turn";
import { markWaiting } from "./waiting-on-user";

function logPermissionPrompt(
  payload: Record<string, unknown> | null,
  tool: string | null,
  now: Date = new Date()
): void {
  logQuietly("permission_prompt", () => {
    const session = hookSessionId(payload) ?? null;
    appendEvent("permission_prompt", { tool }, { ts: now.toISOString(), session });
    if (session)
      markWaiting("permission", session, { ts: now.toISOString(), tool: tool ?? "" });
  });
}

function logNotification(payload: Record<string, unknown> | null, now: Date): void {
  logQuietly("notification", () => {
    const session = hookSessionId(payload) ?? null;
    const kind =
      typeof payload?.notification_type === "string" ? payload.notification_type : null;
    appendEvent("notification", { kind }, { ts: now.toISOString(), session });
    if (session) markWaiting("notified", session, { ts: now.toISOString() });
  });
}

/** Claude's PermissionRequest and Notification share one hook; it prints nothing. */
export function logAttention(
  payload: Record<string, unknown> | null,
  now: Date = new Date()
): void {
  const event = payload?.hook_event_name ?? payload?.hookEventName;
  if (event === "Notification") logNotification(payload, now);
  if (event === "PermissionRequest")
    logPermissionPrompt(payload, normalizeToolUse(payload)?.toolName ?? null, now);
}
