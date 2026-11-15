import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AgentType, getActiveAgent } from "../core/agent";
import { logError } from "../core/log";
import { paths } from "../core/paths";
import {
  type AgentLogin,
  type CommandRunner,
  type LoginRead,
  readAgentLogin,
  reportsLoginExpiry,
  systemRunner,
} from "./agent-login";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function loginCacheFile(): string {
  return resolve(paths.cache(), "claude-login.json");
}

export function readLoginCache(): AgentLogin | null {
  try {
    const login = JSON.parse(readFileSync(loginCacheFile(), "utf-8"));

    return typeof login?.checkedAt === "string" ? login : null;
  } catch {
    return null;
  }
}

function writeLoginCache(login: AgentLogin): void {
  const file = loginCacheFile();
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, `${JSON.stringify(login)}\n`, "utf-8");
  renameSync(partial, file);
}

export function isLoginCacheStale(login: AgentLogin | null, now: Date): boolean {
  const age = login ? now.getTime() - Date.parse(login.checkedAt) : Number.NaN;

  return !(age <= STALE_AFTER_MS);
}

export function refreshLogin(agent: AgentType, run: CommandRunner, now: Date): LoginRead {
  const read = readAgentLogin(agent, run, now);
  if (read.kind === "known") writeLoginCache(read.login);

  return read;
}

export function refreshLoginOnStart(
  agent: AgentType = getActiveAgent(),
  run: CommandRunner = systemRunner,
  now: Date = new Date()
): void {
  try {
    if (!reportsLoginExpiry(agent) || !isLoginCacheStale(readLoginCache(), now)) return;
    const read = refreshLogin(agent, run, now);
    if (read.kind === "failed") logError("login-refresh", read.reason);
  } catch (err) {
    logError("login-refresh", err);
  }
}
