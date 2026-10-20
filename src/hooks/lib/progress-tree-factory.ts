/**
 * A dark-factory task attached to a node gets its PR once the factory's own event log says it opened or adopted one; the log is only ever read.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  attachOnce,
  buildTree,
  readEvents,
  type WorkEvent,
  type WorkNode,
} from "./progress-tree";

interface FactoryPr {
  task: string;
  pr: string;
}

interface TaskHolder {
  node: string;
  session: string | undefined;
}

export interface FactoryOptions {
  file?: string;
  factoryFile?: string;
  now?: Date;
}

const FACTORY_RUN_PREFIX = "dark-factory:";
const PR_EVENTS: ReadonlySet<string> = new Set(["pr_opened", "pr_adopted"]);

function factoryEventsFile(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(
    env.DARK_FACTORY_HOME || resolve(homedir(), ".dark-factory"),
    "events.jsonl"
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function parsedLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseFactoryLine(line: string): FactoryPr[] {
  const { event, task, pr } = parsedLine(line) ?? {};
  return typeof event === "string" && PR_EVENTS.has(event) && isText(task) && isText(pr)
    ? [{ task, pr }]
    : [];
}

function readFactoryPrs(factoryFile: string): FactoryPr[] {
  if (!existsSync(factoryFile)) return [];
  return readFileSync(factoryFile, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap(parseFactoryLine);
}

function uniquePrs(prs: FactoryPr[]): FactoryPr[] {
  return [...new Map(prs.map((p) => [JSON.stringify([p.task, p.pr]), p])).values()];
}

function taskHolders(events: WorkEvent[], scope: string): Map<string, TaskHolder> {
  const holders = new Map<string, TaskHolder>();
  for (const event of events) {
    if (event.scope !== scope || event.type !== "attach" || event.kind !== "run")
      continue;
    if (!event.ref.startsWith(FACTORY_RUN_PREFIX)) continue;
    holders.set(event.ref.slice(FACTORY_RUN_PREFIX.length), {
      node: event.node,
      session: event.session,
    });
  }
  return holders;
}

function attachHeldPr(
  scope: string,
  nodes: Map<string, WorkNode>,
  holders: Map<string, TaskHolder>,
  { task, pr }: FactoryPr,
  attached: Set<string>,
  options: FactoryOptions
): void {
  const holder = holders.get(task);
  const node = holder ? nodes.get(holder.node) : undefined;
  if (!holder || !node) return;
  const key = JSON.stringify([node.id, pr]);
  if (attached.has(key)) return;
  attached.add(key);
  attachOnce(
    scope,
    node,
    { kind: "pr", ref: pr },
    options.file,
    options.now ?? new Date(),
    holder.session
  );
}

export function attachFactoryPrs(scope: string, options: FactoryOptions = {}): void {
  try {
    const prs = uniquePrs(readFactoryPrs(options.factoryFile ?? factoryEventsFile()));
    if (prs.length === 0) return;
    const events = readEvents(options.file);
    const holders = taskHolders(events, scope);
    if (holders.size === 0) return;
    const { nodes } = buildTree(scope, events);
    const attached = new Set<string>();
    for (const pr of prs) attachHeldPr(scope, nodes, holders, pr, attached, options);
  } catch {
    return;
  }
}
