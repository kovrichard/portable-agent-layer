#!/usr/bin/env bun
/**
 * Thread — Manage open threads across sessions.
 *
 * Threads are unresolved questions, decisions, or tasks that survive session boundaries.
 * Stored in memory/state/threads.jsonl as structured records.
 *
 * Usage:
 *   bun ~/.pal/tools/thread.ts --add --title "..." [--context "..."]
 *   bun ~/.pal/tools/thread.ts --resolve --id <id>
 *   bun ~/.pal/tools/thread.ts --list [--all]
 */

import { parseArgs } from "node:util";
import { emit } from "../lib/emit";
import {
  addThread,
  readThreads,
  resolveThreadIn,
  threadsFile,
  visibleThreads,
  writeThreads,
} from "../lib/thread";

const HELP = `
Thread — Manage open threads across sessions

Usage:
  thread.ts --add --title "..." [--context "..."]
  thread.ts --resolve --id <id>
  thread.ts --list [--all]
`;

function add(title: string | undefined, context: string | undefined) {
  if (!title) {
    console.error("--title required");
    process.exit(1);
  }
  const thread = addThread(title, context ?? "");
  emit.receipt(threadsFile(), {
    id: thread.id,
    title: thread.title,
    status: thread.status,
  });
}

function markResolved(id: string | undefined) {
  if (!id) {
    console.error("--id required");
    process.exit(1);
  }
  const file = threadsFile();
  const resolution = resolveThreadIn(readThreads(file), id, new Date());
  if (!resolution) {
    console.error(`Thread not found: ${id}`);
    process.exit(1);
  }
  writeThreads(resolution.threads, file);
  emit.receipt(file, { id, status: "resolved", title: resolution.thread.title });
}

function run() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      add: { type: "boolean" },
      resolve: { type: "boolean" },
      list: { type: "boolean" },
      title: { type: "string" },
      context: { type: "string" },
      id: { type: "string" },
      all: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  let cmd: string | null = null;
  if (values.add) cmd = "add";
  else if (values.resolve) cmd = "resolve";
  else if (values.list) cmd = "list";

  if (values.help || !cmd) {
    console.log(HELP);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === "add") add(values.title, values.context);
  if (cmd === "resolve") markResolved(values.id);
  if (cmd === "list") {
    const threads = visibleThreads(readThreads(), values.all ?? false);
    emit.data(JSON.stringify({ count: threads.length, threads }, null, 2));
  }
}

if (import.meta.main) run();
