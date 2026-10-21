import { beforeEach } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvent, readTree, scopeOf } from "../../src/hooks/lib/progress-tree";
import { loadProgressTreeContext } from "../../src/hooks/lib/progress-tree-context";
import { reload } from "../../src/hooks/lib/settings";
import { freshTestDir } from "./test-home";

export const PR = "https://github.com/acme/widgets/pull/42";
export const TASK = "2026-10-20-some-task";
export const OTHER_TASK = "2026-10-20-other-task";
export const SESSION = "sess-1";
const SAVED_ENV = ["PAL_HOME", "PAL_AGENT", "CLAUDE_PROJECT_DIR", "DARK_FACTORY_HOME"];

export const paths = { home: "", folder: "", factoryLog: "" };
let saved: Record<string, string | undefined> | undefined;

export function setting(value: boolean) {
  mkdirSync(resolve(paths.home, "memory"), { recursive: true });
  writeFileSync(
    resolve(paths.home, "memory", "pal-settings.json"),
    JSON.stringify({ dynamicContext: { progressTree: value } })
  );
  reload();
}

function restoreEnv(): void {
  if (saved) {
    for (const k of SAVED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  reload();
}

export function startEachTestInAFreshHome(testFile: string) {
  beforeEach(() => {
    restoreEnv();
    saved = Object.fromEntries(SAVED_ENV.map((k) => [k, process.env[k]]));
    paths.home = freshTestDir(testFile);
    paths.folder = resolve(paths.home, "repo");
    mkdirSync(paths.folder, { recursive: true });
    paths.factoryLog = resolve(paths.home, "factory", "events.jsonl");
    mkdirSync(resolve(paths.home, "factory"), { recursive: true });
    process.env.PAL_HOME = paths.home;
    process.env.PAL_AGENT = "claude";
    process.env.CLAUDE_PROJECT_DIR = paths.folder;
    process.env.DARK_FACTORY_HOME = resolve(paths.home, "factory");
    setting(true);
  });
}

export const scope = () => scopeOf(paths.folder);
export const tree = () => readTree(scope(), undefined, SESSION);
export const attachments = () =>
  [...tree().nodes.values()].flatMap((n) =>
    n.artifacts.map((a) => [n.id, a.kind, a.ref])
  );

export function openNode(id = "n1") {
  appendEvent(
    scope(),
    id,
    "open",
    { title: "Work", parent: null },
    undefined,
    undefined,
    SESSION
  );
}

export function attach(node: string, kind: "pr" | "run", ref: string) {
  appendEvent(scope(), node, "attach", { kind, ref }, undefined, undefined, SESSION);
}

export function factoryEvent(event: string, task: string, pr = PR) {
  appendFileSync(
    paths.factoryLog,
    `${JSON.stringify({ ts: new Date().toISOString(), event, task, pr })}\n`
  );
}

export const sessionStart = () =>
  loadProgressTreeContext(paths.folder, SESSION, () => null);

export function nodeHoldingTask(id = "n1", task = TASK) {
  openNode(id);
  attach(id, "run", `dark-factory:${task}`);
}
