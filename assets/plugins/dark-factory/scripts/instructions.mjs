import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { appendEvent, readUserConfig, taskDir, userHome } from "./lib.mjs";

const MAX_IMPORT_DEPTH = 5;
const IMPORT_LINE = /^@(\S+)/;
const FENCE = /^ {0,3}(```|~~~)/;
const INSTRUCTIONS_FILE = "role-instructions.md";
const MISSING_SEEN_FILE = "instructions-missing-recorded.txt";

function importTarget(path, fromFile, env) {
  if (path.startsWith("~/")) return join(userHome(env), path.slice(2));
  if (isAbsolute(path)) return path;
  return resolve(dirname(fromFile), path);
}

function readOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function importedLine(line, file, env, depth, missing) {
  const match = IMPORT_LINE.exec(line);
  const target = importTarget(match[1], file, env);
  const content = readOrNull(target);
  if (content === null) {
    missing.push(target);
    return line;
  }
  const nested = resolveImports(content, target, env, depth + 1);
  missing.push(...nested.missing);
  return nested.text.replace(/\n$/, "") + line.slice(match[0].length);
}

function resolveImports(text, file, env = process.env, depth = 0) {
  const missing = [];
  let insideFence = false;
  const lines = text.split("\n").map((line) => {
    if (FENCE.test(line)) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence || depth >= MAX_IMPORT_DEPTH || !IMPORT_LINE.test(line)) return line;
    return importedLine(line, file, env, depth, missing);
  });
  return { text: lines.join("\n"), missing };
}

export function readInstructions(file, env = process.env) {
  const content = readOrNull(file);
  if (content === null) return null;
  return { path: file, ...resolveImports(content, file, env) };
}

export function recordMissingImports(taskId, missing, env = process.env) {
  for (const path of missing) {
    appendEvent({ event: "instructions_import_missing", task: taskId, path }, env);
  }
}

function recordNewMissingImports(taskId, missing, env) {
  if (missing.length === 0) return;
  const file = join(taskDir(taskId, env), MISSING_SEEN_FILE);
  const seen = (readOrNull(file) ?? "").split("\n").filter(Boolean);
  const fresh = [...new Set(missing)].filter((path) => !seen.includes(path));
  if (fresh.length === 0) return;
  recordMissingImports(taskId, fresh, env);
  writeFileSync(file, `${[...seen, ...fresh].join("\n")}\n`);
}

function userPart(env) {
  if (readUserConfig(env).userInstructions === false) return null;
  return readInstructions(join(userHome(env), ".claude", "CLAUDE.md"), env);
}

function instructionsText(parts) {
  if (parts.length === 0) return null;
  const sections = parts.map((part) => `# ${part.path}\n\n${part.text.trimEnd()}`);
  return `${sections.join("\n\n")}\n`;
}

export function writeRoleInstructions(task, env = process.env) {
  const user = userPart(env);
  if (user) recordNewMissingImports(task.id, user.missing, env);
  const parts = [user, task.repoClaudeMd ?? null].filter(Boolean);
  const text = instructionsText(parts);
  if (text === null) return null;
  const file = join(taskDir(task.id, env), INSTRUCTIONS_FILE);
  writeFileSync(file, text);
  return file;
}
