import { type AgentType, getActiveAgent } from "../core/agent";
import {
  type AgentLogin,
  type CommandRunner,
  type LoginRead,
  reportsLoginExpiry,
  systemRunner,
} from "../hooks/lib/agent-login";
import { readLoginCache, refreshLogin } from "../hooks/lib/login-cache";
import { leaf } from "../tools/lib/command";

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

function timeLeft(secondsLeft: number): string {
  return secondsLeft < DAY_S
    ? `${Math.floor(secondsLeft / HOUR_S)} hours left`
    : `${Math.floor(secondsLeft / DAY_S)} days left`;
}

function expiryWords(login: AgentLogin, now: Date): string {
  if (login.expiresAtEpoch === null || login.expiresAt === null) {
    return "this agent does not report when its login expires";
  }

  const secondsLeft = login.expiresAtEpoch - Math.floor(now.getTime() / 1000);
  if (secondsLeft <= 0) return `login expired on ${login.expiresAt}`;

  return `login expires on ${login.expiresAt}, ${timeLeft(secondsLeft)}`;
}

export function describeLogin(agent: AgentType, read: LoginRead, now: Date): string {
  if (read.kind === "failed") return `${agent}: ${read.reason}`;

  if (read.kind === "unknown") {
    return `${agent}: this agent does not report when its login expires`;
  }

  const { login } = read;
  const state = login.loggedIn ? `logged in (${login.authMethod})` : "not logged in";

  return `${agent}: ${state}; ${expiryWords(login, now)}`;
}

function currentLogin(
  agent: AgentType,
  refresh: boolean,
  run: CommandRunner,
  now: Date
): LoginRead {
  const cached = refresh || !reportsLoginExpiry(agent) ? null : readLoginCache();

  return cached ? { kind: "known", login: cached } : refreshLogin(agent, run, now);
}

export interface AuthFlags {
  refresh?: boolean;
  json?: boolean;
}

export function runAuth(
  flags: AuthFlags,
  agent: AgentType = getActiveAgent(),
  run: CommandRunner = systemRunner,
  now: Date = new Date()
): number {
  const read = currentLogin(agent, Boolean(flags.refresh), run, now);

  if (read.kind === "failed") {
    console.error(describeLogin(agent, read, now));

    return 1;
  }

  const login = read.kind === "known" ? read.login : null;
  console.log(
    flags.json ? JSON.stringify(login, null, 2) : describeLogin(agent, read, now)
  );

  return 0;
}

export const authCommand = leaf({
  summary: "When the active agent's login expires",
  options: {
    refresh: {
      type: "boolean",
      description: "Ask the agent again and rewrite the cached answer",
    },
    json: { type: "boolean", description: "Print the cached answer as JSON" },
  },
  run: ({ values }) => runAuth(values),
});
