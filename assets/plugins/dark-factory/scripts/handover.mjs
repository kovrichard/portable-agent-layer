import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvent, taskDir } from "./lib.mjs";

function nextNumber(dir) {
  return existsSync(dir) ? readdirSync(dir).length + 1 : 1;
}

export function savePayload(taskId, folder, name, text, env = process.env) {
  const dir = join(taskDir(taskId, env), folder);
  mkdirSync(dir, { recursive: true });
  const file = join(folder, `${String(nextNumber(dir)).padStart(3, "0")}-${name}`);
  writeFileSync(join(taskDir(taskId, env), file), text);

  return {
    file,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
  };
}

export function recordHandover(taskId, { from, to, reason, payload }, env = process.env) {
  const saved = savePayload(
    taskId,
    "handovers",
    `${from}-to-${to}.md`,
    payload ?? "",
    env
  );
  appendEvent({ event: "handover", task: taskId, from, to, reason, payload: saved }, env);

  return saved;
}
