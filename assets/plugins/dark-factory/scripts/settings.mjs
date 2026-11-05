import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendEvent, taskDir, userHome } from "./lib.mjs";

const SETTINGS_FILE = "role-settings.json";
const KEYS_THAT_BREAK_ISOLATION = [
  "hooks",
  "permissions",
  "enabledPlugins",
  "extraKnownMarketplaces",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(file) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function userSettings(env) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(userHome(env), ".claude");
  return readJsonObject(join(configDir, "settings.json")) ?? {};
}

export function roleSettingsFrom(userSettings) {
  const kept = Object.fromEntries(
    Object.entries(userSettings).filter(
      ([key]) => !KEYS_THAT_BREAK_ISOLATION.includes(key)
    )
  );
  return Object.keys(kept).length > 0 ? kept : null;
}

function recordRoleSettings(taskId, user, kept, env) {
  appendEvent(
    {
      event: "role_settings",
      task: taskId,
      passed: Object.keys(kept ?? {}),
      dropped: Object.keys(user).filter((key) => KEYS_THAT_BREAK_ISOLATION.includes(key)),
    },
    env
  );
}

export function writeRoleSettings(task, env = process.env) {
  const user = userSettings(env);
  const kept = roleSettingsFrom(user);
  recordRoleSettings(task.id, user, kept, env);
  if (kept === null) return null;
  const dir = taskDir(task.id, env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, SETTINGS_FILE);
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
  return file;
}
