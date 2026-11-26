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
const REPO_PERMISSION_LISTS = ["allow", "deny", "ask"];

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

export function repoPermissionsFrom(repoSettings) {
  if (!isPlainObject(repoSettings.permissions)) return null;
  const lists = Object.fromEntries(
    REPO_PERMISSION_LISTS.filter((key) =>
      Array.isArray(repoSettings.permissions[key])
    ).map((key) => [key, repoSettings.permissions[key]])
  );

  return Object.keys(lists).length > 0 ? lists : null;
}

export function withRepoPermissions(kept, permissions) {
  if (permissions === null) return kept;

  return { ...(kept ?? {}), permissions };
}

function repoSettings(task) {
  const root = task.worktree ?? task.repo;
  if (!root) return {};

  return readJsonObject(join(root, ".claude", "settings.json")) ?? {};
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
  const settings = withRepoPermissions(kept, repoPermissionsFrom(repoSettings(task)));
  if (settings === null) return null;
  const dir = taskDir(task.id, env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, SETTINGS_FILE);
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });

  return file;
}
