import { appendEvent } from "../../src/hooks/lib/progress-tree";

interface SeededNode {
  title?: string;
  status?: "active" | "parked" | "waiting" | "done";
  at?: string;
  stoppedAt?: string;
  waitingOn?: string;
}

function ownSessionOf(node: string): string {
  return `seed-${node}`;
}

function record<T extends Parameters<typeof appendEvent>[2]>(
  scope: string,
  node: string,
  type: T,
  payload: Parameters<typeof appendEvent<T>>[3],
  at: Date
): void {
  appendEvent(scope, node, type, payload, undefined, at, ownSessionOf(node));
}

export function seedWorkNode(scope: string, node: string, seed: SeededNode = {}): void {
  const at = new Date(seed.at ?? "2026-09-04T18:00:00.000Z");
  record(scope, node, "open", { title: seed.title ?? `title ${node}`, parent: null }, at);
  record(scope, node, "enter", {}, at);
  if (seed.stoppedAt) record(scope, node, "stopped", { text: seed.stoppedAt }, at);
  if (seed.status === "waiting") {
    record(scope, node, "wait", { on: seed.waitingOn ?? "a decision" }, at);
  }
  if (seed.status === "parked") record(scope, node, "park", {}, at);
  if (seed.status === "done") record(scope, node, "done", {}, at);
}
