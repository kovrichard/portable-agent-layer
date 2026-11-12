import { readFileSync } from "node:fs";
import {
  appendEvent,
  isMain,
  readEvents,
  taskForFolder,
  transcriptLines,
  transcriptTotals,
} from "./lib.mjs";
import { transcriptCost } from "./prices.mjs";

function latestRun(events, taskId) {
  const mine = events.filter((event) => event.task === taskId);
  const start = mine.findLastIndex((event) => event.event === "task_started");
  if (start === -1) return null;
  const run = mine.slice(start);

  return run.some((event) => event.event === "run_finished") ? run : null;
}

export function recordSessionEnd(input, env = process.env) {
  if (env.DARK_FACTORY_ROLE) return null;
  const task = taskForFolder(input.cwd ?? process.cwd(), env);
  if (!task) return null;
  const run = latestRun(readEvents(env), task.id);
  if (!run) return null;
  const last = run
    .filter(
      (event) =>
        event.event === "role_finished" &&
        event.role === "po" &&
        event.sessionId === input.session_id
    )
    .at(-1);
  if (!last) return null;
  const after = Date.parse(last.ts);
  const transcriptPath = input.transcript_path ?? last.transcriptPath;
  const counted = transcriptLines(transcriptPath).filter(
    (line) => line.type === "assistant" && Date.parse(line.timestamp) > after
  );
  const totals = transcriptTotals(counted);
  if (totals.turns === 0) return null;
  const event = {
    event: "role_finished",
    task: task.id,
    role: "po",
    ...totals,
    costUsd: transcriptCost(counted),
    sessionId: input.session_id,
    transcriptPath,
    exitCode: 0,
    error: null,
    afterRunFinished: true,
  };
  appendEvent(event, env);

  return event;
}

if (isMain(import.meta.url)) {
  try {
    recordSessionEnd(JSON.parse(readFileSync(0, "utf8")));
  } catch (error) {
    process.stderr.write(`dark-factory session end: ${error.message}\n`);
  }
}
