import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logError } from "../../core/log";
import { paths } from "../../core/paths";
import { agentFailureText } from "./inference-prompt";

export const CLAUDE_LOGIN_REJECTED = /Failed to authenticate/;

export type ClaudeAuthMode = "token" | "native";

interface ClaudeExit {
  code: number | null;
  stdout: string;
}

export function loginRejectedFile(): string {
  return resolve(paths.cache(), "login-rejected.json");
}

function recordLoginRejected(auth: ClaudeAuthMode, now: Date): void {
  const at = now.toISOString();
  writeFileSync(loginRejectedFile(), `${JSON.stringify({ at, auth })}\n`, "utf-8");
}

function clearLoginRejected(): void {
  const file = loginRejectedFile();
  if (existsSync(file)) rmSync(file);
}

export function noteClaudeLogin(
  auth: ClaudeAuthMode | undefined,
  exit: ClaudeExit,
  now: Date = new Date()
): void {
  if (!auth) return;

  try {
    if (exit.code === 0) clearLoginRejected();
    else if (CLAUDE_LOGIN_REJECTED.test(agentFailureText(exit.stdout)))
      recordLoginRejected(auth, now);
  } catch (err) {
    logError("inference:login-rejected", err);
  }
}
