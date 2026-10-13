/**
 * opencode's bus events as PAL events. The plugin lives as long as opencode,
 * so a permission's tool is remembered from its ask until its reply.
 */

import { logCompaction, logSessionStart } from "./session-events";
import { logToolCall } from "./tool-events";

interface OpencodeSession {
  id?: string;
  parentID?: string;
}

interface OpencodePermission {
  id?: string;
  type?: string;
}

/** v1 of opencode's SDK names these permissionID/response, v2 requestID/reply. */
interface OpencodePermissionReply {
  sessionID?: string;
  permissionID?: string;
  requestID?: string;
  response?: string;
  reply?: string;
}

interface OpencodeToolPart {
  type?: string;
  callID?: string;
  sessionID?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    error?: string;
    time?: { start?: number; end?: number };
  };
}

// opencode's PermissionV1 error messages: RejectedError / CorrectedError for a
// prompt the user refused, DeniedError for a configured rule.
const USER_REJECTED = "The user rejected permission";
const RULE_DENIED = "The user has specified a rule which prevents";

const askedTools = new Map<string, string>();
const loggedFailures = new Set<string>();

export function logOpencodeSessionCreated(session: OpencodeSession | undefined): void {
  if (!session?.id || session.parentID) return;
  logSessionStart({ session_id: session.id, source: "startup" });
}

export function logOpencodeCompaction(sessionID: string | undefined): void {
  logCompaction({ session_id: sessionID });
}

export function rememberAskedTool(permission: OpencodePermission): void {
  if (permission.id && permission.type) askedTools.set(permission.id, permission.type);
}

function takeAskedTool(reply: OpencodePermissionReply): string | undefined {
  const id = reply.permissionID ?? reply.requestID;
  if (!id) return undefined;
  const tool = askedTools.get(id);
  askedTools.delete(id);
  return tool;
}

export function logOpencodePermissionReply(reply: OpencodePermissionReply): void {
  const tool = takeAskedTool(reply);
  if ((reply.response ?? reply.reply) !== "reject" || !tool) return;
  logToolCall({
    hook_event_name: "PermissionDenied",
    tool_name: tool,
    session_id: reply.sessionID,
  });
}

function durationOf(part: OpencodeToolPart): number | null {
  const { start, end } = part.state?.time ?? {};
  return start !== undefined && end !== undefined ? end - start : null;
}

function firstFailureOf(part: OpencodeToolPart | undefined): part is OpencodeToolPart {
  if (part?.type !== "tool" || part.state?.status !== "error" || !part.callID)
    return false;
  if (loggedFailures.has(part.callID)) return false;
  loggedFailures.add(part.callID);
  return true;
}

/** A tool that threw never reaches tool.execute.after; its part turning to error is the only trace. */
export function logOpencodeToolFailure(part: OpencodeToolPart | undefined): void {
  if (!firstFailureOf(part)) return;
  const error = part.state?.error ?? "";
  if (error.startsWith(USER_REJECTED)) return;
  logToolCall({
    hook_event_name: error.startsWith(RULE_DENIED)
      ? "PermissionDenied"
      : "PostToolUseFailure",
    tool_name: part.tool,
    tool_input: part.state?.input,
    session_id: part.sessionID,
    error,
    duration_ms: durationOf(part),
  });
}
