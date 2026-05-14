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

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensureDir, paths } from "../../hooks/lib/paths";

// ── Types ──

interface Thread {
  id: string;
  cwd: string;
  title: string;
  context: string;
  status: "open" | "resolved";
  created: string;
  resolved: string | null;
}

// ── Storage ──

function threadsPath(): string {
  return resolve(ensureDir(paths.state()), "threads.jsonl");
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function readThreads(): Thread[] {
  const p = threadsPath();
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Thread);
  } catch {
    return [];
  }
}

function writeThreads(threads: Thread[]): void {
  writeFileSync(
    threadsPath(),
    `${threads.map((t) => JSON.stringify(t)).join("\n")}\n`,
    "utf-8"
  );
}

// ── Operations ──

function addThread(title: string, context: string): Thread {
  const thread: Thread = {
    id: generateId(),
    cwd: process.cwd(),
    title,
    context,
    status: "open",
    created: new Date().toISOString(),
    resolved: null,
  };
  appendFileSync(threadsPath(), `${JSON.stringify(thread)}\n`, "utf-8");
  return thread;
}

function resolveThread(id: string): {
  success: boolean;
  thread?: Thread;
  message: string;
} {
  const threads = readThreads();
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return { success: false, message: `Thread not found: ${id}` };
  threads[idx].status = "resolved";
  threads[idx].resolved = new Date().toISOString();
  writeThreads(threads);
  return {
    success: true,
    thread: threads[idx],
    message: `Resolved: ${threads[idx].title}`,
  };
}

function listThreads(all: boolean): Thread[] {
  return all ? readThreads() : readThreads().filter((t) => t.status === "open");
}

// ── CLI ──

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

  const cmd = values.add
    ? "add"
    : values.resolve
      ? "resolve"
      : values.list
        ? "list"
        : null;

  if (values.help || !cmd) {
    console.log(`
Thread — Manage open threads across sessions

Usage:
  thread.ts --add --title "..." [--context "..."]
  thread.ts --resolve --id <id>
  thread.ts --list [--all]
`);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === "add") {
    if (!values.title) {
      console.error("--title required");
      process.exit(1);
    }
    const thread = addThread(values.title, values.context ?? "");
    console.log(
      JSON.stringify(
        { success: true, id: thread.id, message: `Thread added: ${thread.title}` },
        null,
        2
      )
    );
  }

  if (cmd === "resolve") {
    if (!values.id) {
      console.error("--id required");
      process.exit(1);
    }
    console.log(JSON.stringify(resolveThread(values.id), null, 2));
  }

  if (cmd === "list") {
    const threads = listThreads(values.all ?? false);
    console.log(JSON.stringify({ count: threads.length, threads }, null, 2));
  }
}

if (import.meta.main) run();
