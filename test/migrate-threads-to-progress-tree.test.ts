import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPendingMigrations,
  checkPendingMigrations,
  runMigrate,
} from "../src/cli/migrate";
import { appendEvent, buildTree, readEvents } from "../src/hooks/lib/progress-tree";
import { freshTestDir } from "./lib/test-home";

const MIGRATION = "v10-threads-to-progress-tree";
const CREATED = "2026-09-10T08:00:00.000Z";
const FOLDER = resolve("/work/somewhere");

let HOME: string;

const threadsFile = () => resolve(HOME, "memory", "state", "threads.jsonl");

function thread(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    cwd: FOLDER,
    title: `title ${id}`,
    context: `context ${id}`,
    status: "open",
    created: CREATED,
    resolved: null,
    ...fields,
  };
}

function writeThreads(...threads: object[]): void {
  mkdirSync(resolve(threadsFile(), ".."), { recursive: true });
  writeFileSync(threadsFile(), `${threads.map((t) => JSON.stringify(t)).join("\n")}\n`);
}

const treeOf = (scope: string, session?: string) =>
  buildTree(scope, readEvents(), session);
const pendingIds = () => checkPendingMigrations().map((m) => m.id);

function quietly(fn: () => void): string {
  const captured: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => captured.push(parts.join(" "));
  try {
    fn();
  } finally {
    console.log = log;
  }
  return captured.join("\n");
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
});

describe(MIGRATION, () => {
  test("parks an open thread in its folder's tree, stopped at its context", () => {
    writeThreads(thread("t1"));
    expect(pendingIds()).toContain(MIGRATION);

    applyPendingMigrations();

    const node = treeOf(FOLDER).nodes.get("t1");
    expect(node).toMatchObject({
      title: "title t1",
      status: "parked",
      stoppedAt: "context t1",
      opened: CREATED,
    });
    expect(pendingIds()).not.toContain(MIGRATION);
  });

  test("a thread anchored to a project parks in that project's tree", () => {
    writeThreads(thread("t1", { cwd: "{proj:some-project}" }));
    applyPendingMigrations();
    expect(treeOf("some-project").nodes.get("t1")?.status).toBe("parked");
  });

  test("a resolved thread stays out of the tree", () => {
    writeThreads(thread("t1", { status: "resolved", resolved: CREATED }));
    expect(pendingIds()).not.toContain(MIGRATION);
    applyPendingMigrations();
    expect(readEvents()).toEqual([]);
  });

  test("running twice parks each thread once", () => {
    writeThreads(thread("t1"), thread("t2"));
    applyPendingMigrations();
    const once = readEvents().length;

    expect(applyPendingMigrations().filter((l) => l.startsWith(MIGRATION))).toEqual([]);
    expect(readEvents()).toHaveLength(once);
    expect(once).toBe(4);
  });

  test("keeps the thread file as it was", () => {
    writeThreads(thread("t1"));
    const before = readFileSync(threadsFile(), "utf-8");
    applyPendingMigrations();
    expect(readFileSync(threadsFile(), "utf-8")).toBe(before);
  });

  test("leaves the node a session-less lane held at that time active", () => {
    appendEvent(
      FOLDER,
      "held",
      "open",
      { title: "held work", parent: null },
      undefined,
      new Date("2026-09-01T00:00:00.000Z"),
      ""
    );
    writeThreads(thread("t1"));

    applyPendingMigrations();

    const tree = treeOf(FOLDER);
    expect(tree.nodes.get("held")?.status).toBe("active");
    expect(tree.active).toBe("held");
  });

  test("looking for pending work creates no progress-tree folder", () => {
    writeThreads(thread("t1"));
    pendingIds();
    expect(existsSync(resolve(HOME, "memory", "progress-tree"))).toBe(false);
  });

  test("a dry run names the thread and writes nothing", () => {
    writeThreads(thread("t1"));
    const output = quietly(() => runMigrate(["--dry-run"]));
    expect(output).toContain(`t1: would park "title t1" in ${FOLDER}`);
    expect(readEvents()).toEqual([]);
  });
});
