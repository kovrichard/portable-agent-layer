import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { savePayload } from "./handover.mjs";
import {
  appendEvent,
  isMain,
  readEvents,
  transcriptLines,
  transcriptTotals,
} from "./lib.mjs";
import { transcriptCost } from "./prices.mjs";
import { listTasks } from "./task.mjs";

const ROLE_PREFIX = "dark-factory:";

function insideFolder(folder, path) {
  const rel = relative(resolve(folder), resolve(path));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function taskForFolder(cwd, env) {
  return listTasks(env).find((task) => task.worktree && insideFolder(task.worktree, cwd));
}

const FLUSH_WAIT_MS = 3000;
const FLUSH_POLL_MS = 100;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assistantText(lines) {
  return lines
    .filter((line) => line.type === "assistant")
    .flatMap((line) => {
      const content = line.message?.content;
      if (typeof content === "string") return [content];
      return (content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text);
    })
    .join("\n");
}

function holdsReply(lines, reply) {
  return !reply?.trim() || assistantText(lines).includes(reply.trim());
}

function linesOnceReplyIsWritten(path, reply, waitMs) {
  if (!path || !existsSync(path)) return [];
  const deadline = Date.now() + waitMs;
  let lines = transcriptLines(path);
  while (!holdsReply(lines, reply) && Date.now() < deadline) {
    sleep(FLUSH_POLL_MS);
    lines = transcriptLines(path);
  }
  return lines;
}

function previousStopTs(events, taskId, agentId) {
  if (agentId == null) return null;
  const earlier = events.filter(
    (event) =>
      event.event === "role_finished" &&
      event.task === taskId &&
      event.agentId === agentId
  );
  return earlier.at(-1)?.ts ?? null;
}

function stopTotals(lines, afterTs) {
  if (afterTs === null) {
    return { ...transcriptTotals(lines), costUsd: transcriptCost(lines) };
  }
  const after = Date.parse(afterTs);
  const counted = lines.filter(
    (line) => line.type === "assistant" && Date.parse(line.timestamp) > after
  );
  const totals = transcriptTotals(counted);
  return {
    ...totals,
    model: transcriptTotals(lines).model,
    durationMs: totals.durationMs ?? 0,
    costUsd: transcriptCost(counted),
  };
}

function savedReply(taskId, role, text, env) {
  const body = { result: text ?? null, structured: null };
  return savePayload(
    taskId,
    "replies",
    `${role}.json`,
    `${JSON.stringify(body, null, 2)}\n`,
    env
  );
}

export function recordSubagentStop(input, env = process.env, waitMs = FLUSH_WAIT_MS) {
  const agentType = input.agent_type ?? "";
  if (!agentType.startsWith(ROLE_PREFIX) || env.DARK_FACTORY_ROLE) return null;
  const task = taskForFolder(input.cwd ?? process.cwd(), env);
  if (!task) return null;
  const role = agentType.slice(ROLE_PREFIX.length);
  const lines = linesOnceReplyIsWritten(
    input.agent_transcript_path,
    input.last_assistant_message,
    waitMs
  );
  const afterTs = previousStopTs(readEvents(env), task.id, input.agent_id ?? null);
  const event = {
    event: "role_finished",
    task: task.id,
    role,
    ...stopTotals(lines, afterTs),
    agentId: input.agent_id ?? null,
    sessionId: input.session_id ?? null,
    exitCode: 0,
    error: null,
    transcriptPath: input.agent_transcript_path ?? null,
    reply: savedReply(task.id, role, input.last_assistant_message, env),
  };
  appendEvent(event, env);
  return event;
}

if (isMain(import.meta.url)) {
  try {
    recordSubagentStop(JSON.parse(readFileSync(0, "utf8")));
  } catch (error) {
    process.stderr.write(`dark-factory subagent log: ${error.message}\n`);
  }
}
