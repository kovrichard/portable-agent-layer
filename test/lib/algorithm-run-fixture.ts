import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince, type LoggedEvent } from "../../src/bronze/events";
import { reload } from "../../src/core/settings";
import { observeTurn } from "../../src/hooks/lib/interaction";
import { appendEvent as appendTreeEvent } from "../../src/hooks/lib/progress-tree";

export const PAL_HEADER = "══════ PAL | ALGORITHM ══════";
export const FORMAT_HEADER = "♻️ ALGORITHM ═══════════════════════════";
export const NATIVE_HEADER = "══════ PAL | NATIVE ══════";

const MARKERS: Record<string, string> = {
  OBSERVE: "━━━ 👁️ OBSERVE ━━━ 1/5",
  PLAN: "━━━ 🧠 PLAN ━━━ 2/5",
  EXECUTE: "━━━ ⚡ EXECUTE ━━━ 3/5",
  VERIFY: "━━━ ✅ VERIFY ━━━ 4/5",
  LEARN: "━━━ 📚 LEARN ━━━ 5/5",
};

export function marker(phase: string): string {
  return MARKERS[phase] as string;
}

export function algorithmReply(phases: string[], header = PAL_HEADER): string {
  return [header, "🗒️ TASK: fixture", ...phases.map(marker)].join("\n\n");
}

const ENV_KEYS = [
  "PAL_HOME",
  "PAL_AGENT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_SESSION_ID",
] as const;

type RunEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function setEnv(env: RunEnv): void {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }

  reload();
}

export interface RunSandbox {
  home: string;
  project: string;
}

export function makeSandbox(dir: string): RunSandbox {
  const project = resolve(dir, "project");
  mkdirSync(resolve(dir, "memory"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(resolve(dir, "memory", "pal-settings.json"), "{}");

  return { home: dir, project };
}

/** Runs `body` with the sandbox as PAL home and project, and puts the environment back afterwards. */
export async function inSandbox<T>(
  sandbox: RunSandbox,
  body: () => T | Promise<T>,
  extra: RunEnv = {}
): Promise<T> {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  setEnv({
    PAL_HOME: sandbox.home,
    PAL_AGENT: "claude",
    CLAUDE_PROJECT_DIR: sandbox.project,
    ...extra,
  });

  try {
    return await body();
  } finally {
    setEnv(saved);
  }
}

export function enterNode(
  sandbox: RunSandbox,
  node: string,
  session: string,
  at = new Date("2026-11-15T09:00:00.000Z")
): void {
  const scope = resolve(sandbox.project);
  appendTreeEvent(
    scope,
    node,
    "open",
    { title: `title ${node}`, parent: null },
    undefined,
    at,
    session
  );
  appendTreeEvent(scope, node, "enter", {}, undefined, at, session);
}

/** Logs a user prompt for the session and returns the id of its turn event. */
export function prompt(session: string, at: Date): string {
  observeTurn(`please do the next step ${at.getTime()}`, session, at, null);
  const turns = eventsSince("turn", new Date(0)).filter((e) => e.session === session);

  return turns.at(-1)?.id as string;
}

export function runEvents(): LoggedEvent[] {
  return eventsSince("algorithm_run", new Date(0));
}

export function changes(): string[] {
  return runEvents().map((e) => String(e.change));
}
