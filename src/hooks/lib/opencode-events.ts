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

const askedTools = new Map<string, string>();

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
