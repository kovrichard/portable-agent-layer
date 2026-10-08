#!/usr/bin/env bun
/**
 * Thread — Manage open threads across sessions.
 *
 * Threads are unresolved questions, decisions, or tasks that survive session boundaries.
 * Stored in memory/state/threads.jsonl as structured records.
 *
 * Usage:
 *   pal cli thread --add --title "..." [--context "..."]
 *   pal cli thread --resolve --id <id>
 *   pal cli thread --list [--all]
 */

import { leaf, runCommand, UsageError } from "../lib/command";
import { emit } from "../lib/emit";
import { scriptArgs } from "../lib/script-args";
import {
  addThread,
  readThreads,
  resolveThreadIn,
  threadsFile,
  visibleThreads,
  writeThreads,
} from "../lib/thread";

const DETAILS = `Modes (one of --add, --resolve, --list is required):
  pal cli thread --add --title "..." [--context "..."]
  pal cli thread --resolve --id <id>
  pal cli thread --list [--all]`;

export const command = leaf({
  summary: "Manage open threads across sessions",
  options: {
    add: { type: "boolean", description: "Open a new thread (needs --title)" },
    resolve: { type: "boolean", description: "Mark a thread resolved (needs --id)" },
    list: { type: "boolean", description: "Print open threads as JSON" },
    title: { type: "string", value: "<text>", description: "Title of the thread to add" },
    context: {
      type: "string",
      value: "<text>",
      description: "Why it matters, what needs to happen (with --add)",
    },
    id: { type: "string", value: "<id>", description: "Id of the thread to resolve" },
    all: { type: "boolean", description: "Include resolved threads (with --list)" },
  },
  details: DETAILS,
  run: ({ values }) => {
    if (values.add) return add(values.title, values.context);
    if (values.resolve) return markResolved(values.id);
    if (values.list) return list(values.all ?? false);
    throw new UsageError("one of --add, --resolve, --list is required");
  },
});

export function run(argv: string[] = scriptArgs()): Promise<number> {
  return runCommand(command, argv, ["pal", "cli", "thread"]);
}

function add(title: string | undefined, context: string | undefined): undefined {
  if (!title) throw new UsageError("--add needs --title");
  const thread = addThread(title, context ?? "");
  emit.receipt(threadsFile(), {
    id: thread.id,
    title: thread.title,
    status: thread.status,
  });
}

function markResolved(id: string | undefined): number {
  if (!id) throw new UsageError("--resolve needs --id");
  const file = threadsFile();
  const resolution = resolveThreadIn(readThreads(file), id, new Date());
  if (!resolution) {
    console.error(`Thread not found: ${id}`);
    return 1;
  }
  writeThreads(resolution.threads, file);
  emit.receipt(file, { id, status: "resolved", title: resolution.thread.title });
  return 0;
}

function list(includeResolved: boolean): undefined {
  const threads = visibleThreads(readThreads(), includeResolved);
  emit.data(JSON.stringify({ count: threads.length, threads }, null, 2));
}

if (import.meta.main) process.exit(await run());
