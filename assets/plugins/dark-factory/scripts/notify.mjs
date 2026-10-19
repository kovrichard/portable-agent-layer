import { spawnSync } from "node:child_process";
import { appendEvent, isMain, printJson } from "./lib.mjs";

export function notify(id, kind, message, env = process.env) {
  const command = env.DARK_FACTORY_NOTIFY;
  const delivered = command
    ? spawnSync("bash", ["-c", command], {
        input: message,
        encoding: "utf8",
        env: { ...env, DARK_FACTORY_TASK: id, DARK_FACTORY_KIND: kind },
      }).status === 0
    : false;
  appendEvent({ event: "notify", task: id, kind, delivered }, env);
  return { delivered, configured: Boolean(command) };
}

if (isMain(import.meta.url)) {
  const [id, kind, message] = process.argv.slice(2);
  printJson(notify(id, kind, message));
}
